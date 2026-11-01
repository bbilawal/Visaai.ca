import {
  DEPARTURE_DATE_KEYS,
  ENTRY_DATE_KEYS,
  intakeFactGap,
  intakeFactSpecs,
  missingIntakeFacts,
  readIntakeFact,
} from '@visaai/types';
import type { IntakeState } from '../intake.state';
import { strategyRegistry } from '../../../../strategies';
import { routeVisaaiId } from './check-complete';
import type { RouteEligibility } from '../../../../strategies/visa-program/base-visa-program.strategy';

/**
 * The bridge between the required-answers list (@visaai/types
 * intake-requirements) and the two model calls of the interview.
 *
 * The interviewer used to be told only "focus on the information THAT visa
 * type's official application asks for", and it never asked IMM 5257's passport
 * type, US status, previous travel to Canada or representative questions (dry
 * run 2026-10-14, #50). Now it is handed the exact unanswered questions, in
 * order, and the extractor is handed the exact keys to record them under — so
 * the answer lands where the completion check and the prefill look for it.
 */

function routeOf(
  state: Pick<IntakeState, 'destinationCountry' | 'requirementsJson'>,
) {
  return { country: state.destinationCountry, visaaiId: routeVisaaiId(state) };
}

/**
 * Keys the route asks under their own name. A synonym map must not move a
 * fact off one of these (the eTA asks `city_of_birth` itself).
 */
export function routeFactKeys(
  state: Pick<IntakeState, 'destinationCountry' | 'requirementsJson'>,
): ReadonlySet<string> {
  return new Set(intakeFactSpecs(routeOf(state)).map((s) => s.key));
}

/**
 * Drop declarations the question asked did not ask (`askedBy`). The extractor
 * reads every answer for every fact, so "close contact at work" became "contact
 * as a health care worker: Yes" (live 2026-10-19) — an answer IRCC takes as a
 * declaration and the applicant never gave. Dropped, it stays unanswered and
 * the interviewer asks it next.
 */
export function withoutUnaskedDeclarations(
  state: Pick<
    IntakeState,
    'destinationCountry' | 'requirementsJson' | 'currentQuestion'
  >,
  extracted: Record<string, unknown>,
): Record<string, unknown> {
  const asked = state.currentQuestion ?? '';
  const out = { ...extracted };
  for (const spec of intakeFactSpecs(routeOf(state))) {
    if (!spec.askedBy || spec.askedBy.test(asked)) continue;
    for (const k of [spec.key, ...(spec.aliases ?? [])]) delete out[k];
  }
  return out;
}

/** Block for the interviewer prompt; '' in discovery mode or when nothing is missing. */
export function requiredQuestionsBlock(
  state: Pick<
    IntakeState,
    | 'destinationCountry'
    | 'requirementsJson'
    | 'profileJson'
    | 'frameworkId'
    | 'visaTypeId'
  >,
): string {
  if (!state.frameworkId && !state.visaTypeId) return '';
  const missing = missingIntakeFacts(state.profileJson, routeOf(state));
  if (missing.length === 0) return '';
  const lines = missing.map((s) => {
    const gap = intakeFactGap(state.profileJson, s);
    // A recorded answer with a gap: ask only for what is missing.
    return gap
      ? `- ${s.question} (already recorded, but still missing — ask only for these: ${gap})`
      : `- ${s.question}`;
  });
  return `REQUIRED BY THE OFFICIAL APPLICATION FORM — STILL UNANSWERED:
${lines.join('\n')}

Ask these, ONE per turn, in the order listed, before anything optional. Do not tell the applicant the interview is finished, and do not hand off to the Documents page as a final step, while any of them is unanswered. Dates must be exact calendar dates.`;
}

/**
 * The route's questions already answered, each with its recorded answer.
 *
 * Live 2026-10-29 (TRV, app 945eb7f1): "No, never." to the military question
 * was recorded as `military_service: false`, and two questions later the
 * interviewer asked "Have you ever served in the military, militia, or civil
 * defence?" — the profile dump showed the key, but nothing tied it to the
 * question being paraphrased. Plain answers only; lists and records are long
 * and are never paraphrased as a yes/no.
 */
export function answeredQuestionsBlock(
  state: Pick<
    IntakeState,
    | 'destinationCountry'
    | 'requirementsJson'
    | 'profileJson'
    | 'frameworkId'
    | 'visaTypeId'
  >,
): string {
  if (!state.frameworkId && !state.visaTypeId) return '';
  const missing = new Set(
    missingIntakeFacts(state.profileJson, routeOf(state)).map((s) => s.key),
  );
  const lines: string[] = [];
  for (const spec of intakeFactSpecs(routeOf(state))) {
    if (missing.has(spec.key)) continue;
    const v = readIntakeFact(state.profileJson, spec);
    let shown: string;
    if (typeof v === 'boolean') shown = v ? 'Yes' : 'No';
    else if (typeof v === 'number') shown = String(v);
    else if (typeof v === 'string' && v.trim()) shown = v.trim().slice(0, 60);
    else continue;
    lines.push(`- ${spec.question} → ${shown}`);
  }
  if (lines.length === 0) return '';
  return `ALREADY ANSWERED — recorded on the profile. NEVER ask any of these again, in these words or any other wording (a question about the same thing is the same question). The applicant may still correct one by saying so. A follow-up asking for the DETAILS of a Yes answer (when, where, what happened — any question still in the unanswered list) is NOT the same question: still ask it.
${lines.join('\n')}`;
}

/** Block for the extractor prompt: the canonical key for each required fact. */
export function canonicalKeysBlock(
  state: Pick<IntakeState, 'destinationCountry' | 'requirementsJson'>,
): string {
  const specs = intakeFactSpecs(routeOf(state)).filter(
    (s) => s.key !== 'duration_of_stay_days',
  );
  const lines = specs.map(
    (s) =>
      `- ${s.key}: ${s.question}${s.shape ? ` — record as ${s.shape}` : ''}`,
  );
  for (const [key, what] of [
    ['planned_entry_date', 'the date the applicant arrives'],
    ['planned_departure_date', 'the date the applicant leaves'],
  ]) {
    if (!specs.some((s) => s.key === key)) lines.push(`- ${key}: ${what}`);
  }
  return `CANONICAL KEYS — when the answer concerns one of these facts, record it under EXACTLY this key (yes/no answers as true/false, dates as YYYY-MM-DD):
${lines.join('\n')}
Do not record a day count (duration_of_stay_days) when both dates are known: it is derived from the dates, and a stored count goes stale when a date is corrected.`;
}

/**
 * Fact groups whose aliases are NOT synonyms of the canonical key, so a value
 * must never be copied across them (`employed: false` is not an `occupation`;
 * a representative's email is not their phone).
 */
const NOT_SYNONYMS = new Set([
  'employed',
  'duration_of_stay_days',
  'representative_contact',
  'representative_paid',
]);

/**
 * Keep one fact under one value when it is recorded under several keys.
 *
 * The canonical key wins on read, but a profile that came through earlier
 * interviews may still hold the same fact under an alias (`departure_date`
 * next to `planned_departure_date`). When an answer updates any key of such a
 * group, the other keys of the group ALREADY on the profile get the same value,
 * so nothing downstream can read the superseded one.
 */
export function alignFactAliases(
  profile: Record<string, unknown>,
  extracted: Record<string, unknown>,
  state: Pick<IntakeState, 'destinationCountry' | 'requirementsJson'>,
): Record<string, unknown> {
  const groups: string[][] = [
    [...ENTRY_DATE_KEYS],
    [...DEPARTURE_DATE_KEYS],
    ...intakeFactSpecs(routeOf(state))
      .filter((s) => !NOT_SYNONYMS.has(s.key))
      .map((s) => [s.key, ...(s.aliases ?? [])]),
  ];
  const out = { ...extracted };
  for (const group of groups) {
    const written = group.find((k) => k in extracted);
    if (!written) continue;
    for (const k of group) {
      if (k !== written && k in profile && !(k in extracted)) {
        out[k] = extracted[written];
      }
    }
  }
  return out;
}

/**
 * What the route's program says about THIS applicant, or null when no program
 * judges the route. One place for the visa-type gate, the selector's list and
 * the interviewer, so the three never disagree.
 */
export function routeEligibility(
  country: string | null | undefined,
  visaaiId: string | null | undefined,
  profile: Record<string, unknown> | null | undefined,
): RouteEligibility | null {
  const program = strategyRegistry.resolveRoute(
    country ?? null,
    visaaiId ?? null,
  )?.program;
  return program?.assessEligibility?.(profile ?? {}) ?? null;
}

/** A verdict that means the chosen route is wrong for this applicant. */
export function rulesRouteOut(
  verdict: RouteEligibility | null | undefined,
): verdict is RouteEligibility {
  return (
    !!verdict &&
    (verdict.status === 'ineligible' || verdict.status === 'not_required')
  );
}

/**
 * The fixed sentence that opens every interview reply while the chosen route
 * is one the profile has ruled out.
 *
 * Prod 2026-10-16, app 5d3a17a4: the eTA was accepted while nationality was
 * unknown; once the profile showed a Pakistani passport the only thing
 * standing between the applicant and an eTA checklist was the model choosing
 * to mention it. The route is not deleted — the applicant changes it.
 */
export function routeIneligibleNotice(verdict: RouteEligibility): string {
  const instead = verdict.recommendedLabel
    ? ` Switch to “${verdict.recommendedLabel}” in the “Which visa are you applying for?” selector above this chat — your answers are kept.`
    : ` Change your route in the “Which visa are you applying for?” selector above this chat — your answers are kept.`;
  return `**Your selected route does not fit your situation.** ${verdict.reason}${instead}`;
}

/**
 * The notice (with its trailing blank line) that opens an interview reply
 * while the chosen route is ruled out for this applicant; '' otherwise and in
 * discovery mode. Shared by ask_question and confirm_update.
 */
export function routeNoticeFor(
  state: Pick<
    IntakeState,
    | 'destinationCountry'
    | 'requirementsJson'
    | 'profileJson'
    | 'frameworkId'
    | 'visaTypeId'
  >,
): string {
  if (!state.frameworkId && !state.visaTypeId) return '';
  const verdict = routeEligibility(
    state.destinationCountry,
    routeVisaaiId(state),
    state.profileJson,
  );
  return rulesRouteOut(verdict) ? `${routeIneligibleNotice(verdict)}\n\n` : '';
}

/**
 * The chosen route's own brief for the interviewer, plus — when the program
 * can judge it — whether THIS applicant may use the route at all.
 *
 * Dry run 2026-10-16: on Canada's eTA the tailored prompt asked about funds and
 * home ties (visitor-visa evidence) and nothing told the model to stop a
 * Pakistani applicant who had picked a route their passport cannot use.
 * Empty for routes no program claims, so every other route is unchanged.
 */
export function routeGuidanceBlock(
  state: Pick<
    IntakeState,
    'destinationCountry' | 'requirementsJson' | 'profileJson'
  >,
): string {
  const program = strategyRegistry.resolveRoute(
    state.destinationCountry,
    routeVisaaiId(state),
  )?.program;
  if (!program) return '';
  const parts: string[] = [];
  const guidance = program.interviewGuidance?.();
  if (guidance) parts.push(guidance);
  const verdict = program.assessEligibility?.(state.profileJson ?? {});
  if (rulesRouteOut(verdict)) {
    const instead = verdict.recommendedLabel
      ? ` The right route is: ${verdict.recommendedLabel}.`
      : '';
    parts.push(
      `THE APPLICANT IS NOT ELIGIBLE FOR THIS ROUTE${verdict.status === 'not_required' ? ' (THEY DO NOT NEED IT)' : ''}: ${verdict.reason}${instead}
Your reply is already prefixed with a notice telling them this and pointing them to the "Which visa are you applying for?" selector above the chat — do not repeat that notice word for word. Do not continue collecting answers for this route; answer their question or ask what the right route needs.`,
    );
  }
  return parts.join('\n\n');
}
