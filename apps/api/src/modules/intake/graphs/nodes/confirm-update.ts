import { ChatOpenAI } from '@langchain/openai';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import type { IntakeState, ProfileChange } from '../intake.state';
import { routeNoticeFor } from './required-facts';
import { languageDirective } from '../../../../i18n/language';
import {
  asUntrustedData,
  UNTRUSTED_DATA_DIRECTIVE,
} from '../../../shared/ai/untrusted';
import {
  findByName,
  isSamePerson,
  personName,
} from '../../../shared/profile/family-members';
import {
  generateQuestion,
  streamQuestion,
  type AskQuestionHooks,
} from './ask-question';

/**
 * The reply to a message sent after the interview is complete.
 *
 * Dry run 2026-10-15 (Canada visitor visa, app 71ad0c29): the chat input was
 * disabled the moment the intake completed, so the applicant could not fix a
 * marriage date recorded as 1999 that had to be 1988-09-16 — and trip dates
 * had needed the same kind of fix earlier. A message after completion is now
 * a correction. It goes through the same extract → update-profile path as any
 * answer (so it merges onto the row and wins over a document's value), and
 * this node answers it: briefly, saying what changed, without restarting
 * discovery or asking anything the interview already covered.
 *
 * It only runs while the intake is still complete after the update. If the
 * correction removed a required answer, check_complete says so and the
 * interview resumes with ask_question instead — progress moves back only then.
 */

const MAX_CHANGES_CHARS = 1500;

const CONFIRM_RULES = `You are VisaAI's intake assistant. The applicant's intake interview is COMPLETE: every required answer is recorded. The applicant has just sent another message — usually a correction or update to an earlier answer.

Your reply:
- Confirm, in short "- " bullets, exactly what was updated: the fact and its new value (and the old value when there was one). Report ONLY changes listed under "Facts changed by this message" — that list is what was saved.
- If the applicant's message gives a detail that is NOT in that list (for example a child's separate family name, or who is accompanying them), do NOT say it was recorded: say plainly that this detail was not saved and ask them to state it again.
- If nothing was recorded as changed and the message was a question, answer it briefly in bullets. If nothing changed and the message looks like a correction, say it was not recorded and ask the applicant to state the corrected value plainly.
- End with one line saying they can keep correcting answers here, or continue to their documents.
- Do NOT ask any new interview questions, do NOT restart the interview, do NOT re-recommend visa types, and do NOT list documents.
- NEVER tell the applicant to consult a lawyer or other professional, and never predict or guarantee an outcome.`;

function display(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(not set)';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

type Person = Record<string, unknown>;

const isPerson = (v: unknown): v is Person =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * A list of NAMED people. Lists of unnamed records (work_history, travel,
 * addresses) are not broken down per person: they keep the plain
 * `key: old → new` line.
 */
const isPeople = (v: unknown): v is Person[] =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.every((p) => isPerson(p) && personName(p).trim() !== '');

const isNames = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

/**
 * One change as the lines the reply may confirm. A list of people is broken
 * down per person and per field (prod 2026-10-21: the reply was handed the
 * whole `children` list before and after, and confirmed details the applicant
 * had typed — separate family names, "accompanying" — that were never in the
 * list). Each line is a fact that IS in the saved profile.
 */
export function changeLines(c: ProfileChange): string[] {
  const { key, from, to } = c;
  if (isPeople(to) && (isPeople(from) || from === null || isNames(from))) {
    const before = isPeople(from) ? from : [];
    const lines: string[] = [];
    for (const p of to) {
      const name = personName(p);
      const was = findByName(before, name);
      if (!was) {
        const fields = Object.entries(p)
          .filter(([, v]) => v !== null && v !== undefined && v !== '')
          .map(([k, v]) => `${k}=${display(v)}`)
          .join(', ');
        lines.push(`${key} › ${name}: added (${fields})`);
        continue;
      }
      for (const [k, v] of Object.entries(p)) {
        if (JSON.stringify(was[k]) === JSON.stringify(v)) continue;
        lines.push(
          `${key} › ${name} › ${k}: ${display(was[k])} → ${display(v)}`,
        );
      }
    }
    for (const p of before) {
      const name = personName(p);
      if (name && !findByName(to, name))
        lines.push(`${key} › ${name}: removed`);
    }
    return lines;
  }
  if (isNames(to) && (isNames(from) || from === null)) {
    const before = from ?? [];
    const lines: string[] = [];
    const added = to.filter((n) => !before.some((b) => isSamePerson(b, n)));
    const removed = before.filter((b) => !to.some((n) => isSamePerson(b, n)));
    if (added.length) lines.push(`${key}: added ${added.join(', ')}`);
    if (removed.length) lines.push(`${key}: removed ${removed.join(', ')}`);
    if (lines.length === 0)
      lines.push(`${key}: ${display(from)} → ${display(to)}`);
    return lines;
  }
  return [`${key}: ${display(from)} → ${display(to)}`];
}

function changesBlock(changes: ProfileChange[]): string {
  if (changes.length === 0) return '(nothing changed)';
  const lines: string[] = [];
  let used = 0;
  const all = changes.flatMap(changeLines);
  for (const line of all) {
    if (used + line.length > MAX_CHANGES_CHARS) {
      lines.push(`… ${all.length - lines.length} more`);
      break;
    }
    lines.push(line);
    used += line.length;
  }
  return lines.join('\n');
}

/** A deterministic confirmation, for when the model is unavailable. */
export function fallbackConfirmation(changes: ProfileChange[]): string {
  const tail =
    'You can keep correcting any answer here, or continue to your documents.';
  if (changes.length === 0) {
    return `- No change was recorded from that message. If you meant to correct an answer, please state the corrected value plainly.\n\n${tail}`;
  }
  const lines = changes.flatMap((c) => {
    if (c.to !== null && typeof c.to === 'object')
      return changeLines(c).map((l) => `- ${l.replace(/_/g, ' ')}`);
    return [`- ${c.key.replace(/_/g, ' ')}: ${display(c.to)}`];
  });
  return `Updated:\n${lines.join('\n')}\n\n${tail}`;
}

export function makeConfirmUpdateNode(
  llm: ChatOpenAI,
  language?: string | null,
  hooks: AskQuestionHooks = {},
) {
  const { onToken, onReady } = hooks;
  const langDirective = languageDirective(language);
  return async function confirmUpdate(
    state: IntakeState,
  ): Promise<Partial<IntakeState>> {
    const changes = state.profileChanges ?? [];
    const last = state.messages.at(-1);
    const said =
      last && last.getType() === 'human' && typeof last.content === 'string'
        ? last.content
        : '';

    const messages = [
      new SystemMessage(
        `${CONFIRM_RULES}\n\n${UNTRUSTED_DATA_DIRECTIVE}${langDirective}`,
      ),
      new HumanMessage(
        `${asUntrustedData('Facts changed by this message (key: old → new)', changesBlock(changes))}\n\n` +
          `${asUntrustedData('Applicant message', said)}\n\n` +
          'Write the reply. Do not ask any new interview questions.',
      ),
    ];

    // A correction that rules the chosen route out (a Pakistani passport on
    // Canada's eTA) is said first, in fixed words — see routeNoticeFor.
    const notice = routeNoticeFor(state);
    if (notice) onToken?.(notice);

    let reply: string;
    try {
      reply = onToken
        ? await streamQuestion(llm, messages, onToken)
        : await generateQuestion(llm, messages);
      if (!reply.trim()) reply = fallbackConfirmation(changes);
    } catch (err) {
      // The correction is already written; a failed confirmation must not
      // turn a saved answer into an error banner.
      console.error(
        '[confirm-update] Error:',
        err instanceof Error ? err.message : err,
      );
      reply = fallbackConfirmation(changes);
    }
    reply = notice + reply;

    await onReady?.(reply, true);
    return {
      currentQuestion: reply,
      messages: [new AIMessage(reply)],
    };
  };
}
