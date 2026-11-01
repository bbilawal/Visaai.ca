import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { IntakeState } from '../intake.state';
import {
  asUntrustedData,
  UNTRUSTED_DATA_DIRECTIVE,
} from '../../../shared/ai/untrusted';
import { mergeProfileUpdate } from '../../../shared/profile/family-members';
import { alignFactAliases, canonicalKeysBlock } from './required-facts';

const EXTRACT_PROMPT = `You are extracting structured data from a user's answer to a visa application interview question.
Return ONLY a JSON object with the extracted facts. Use snake_case keys.
Examples of keys: employed, employer_name, monthly_salary_usd, has_property, property_country, travel_history_countries, family_in_destination, purpose_of_visit, duration_of_stay_days.
If the answer doesn't contain extractable facts, return {}.
Never include the question itself in the output.

REUSING KEYS IS THE POINT. The facts already recorded are listed below. When the
answer concerns a fact that is already there — including when the user is
CORRECTING it — return that EXACT key with the new value. Inventing a second key
for the same fact does not add information: it leaves both the old value and the
new one in the record, and whatever reads it later cannot tell which the user
meant.

Only invent a key when the fact is genuinely new.

Two specific traps:
- A currency belongs in the key only if you know it. Do not copy an amount into
  both a _usd and a _cad key; use the one the user actually stated.
- A corrected date replaces the old date under the old key. Do not add
  "intended_", "corrected_" or "actual_" variants.

People (children, siblings, spouse, parents, other family members) are lists of
objects that ALWAYS carry each person's "name". When an answer adds or changes
a detail about one person, return that person's object with their name — never
an unnamed list ordered by position.

${UNTRUSTED_DATA_DIRECTIVE}`;

/**
 * The facts already on file, for the extractor to correct rather than duplicate.
 *
 * Without it the model invented a fresh key on every turn, so a correction never
 * landed on the fact it corrected. Observed on a live application 2026-09-04:
 * the applicant gave an impossible departure date, was asked to correct it, did
 * so twice, and the profile ended up holding BOTH
 *
 *   departure_date           "May 2026"      (impossible: before arrival)
 *   intended_departure_date  "2027-05-01"    (what the applicant actually said)
 *
 * alongside four different keys for one household income — 120000, 150000 and
 * 250000, two of them labelled _usd for an amount given in CAD. Everything
 * downstream (prefill, readiness, the forms) reads one key and cannot know it is
 * reading a superseded answer.
 *
 * Values are included, not just key names: correcting "May 2026" requires seeing
 * that it says May 2026. Capped, because a long profile would crowd out the
 * answer being extracted, and fenced as untrusted like every other applicant
 * input.
 */
const MAX_KNOWN_FACTS_CHARS = 2000;

function knownFactsBlock(profile: Record<string, unknown>): string {
  // `_`-prefixed keys are bookkeeping (document provenance), not facts.
  const entries = Object.entries(profile ?? {}).filter(
    ([k]) => !k.startsWith('_'),
  );
  if (entries.length === 0) return '(nothing recorded yet)';

  const lines: string[] = [];
  let used = 0;
  for (const [key, value] of entries) {
    const line = `${key}: ${JSON.stringify(value)}`;
    if (used + line.length > MAX_KNOWN_FACTS_CHARS) {
      lines.push(`… ${entries.length - lines.length} more not shown`);
      break;
    }
    lines.push(line);
    used += line.length;
  }
  return lines.join('\n');
}

// NOTE: `language` is accepted to keep the graph's node-construction shape
// uniform, but NO language directive is applied here. This node only performs
// internal classification — it extracts structured snake_case JSON facts into
// profileJson that are never shown to the user as prose. Forcing a response
// language would not change the user-visible output and risks corrupting the
// extracted values (names/numbers must stay verbatim), so it is intentionally
// omitted.
export function makeProcessAnswerNode(
  llm: ChatOpenAI,
  _language?: string | null,
) {
  return async function processAnswer(
    state: IntakeState,
  ): Promise<Partial<IntakeState>> {
    const lastMessage = state.messages[state.messages.length - 1];
    if (!lastMessage || lastMessage.getType() !== 'human') return {};

    const userAnswer =
      typeof lastMessage.content === 'string' ? lastMessage.content : '';

    if (!userAnswer.trim()) return {};

    const response = await llm.invoke([
      new SystemMessage(EXTRACT_PROMPT),
      new HumanMessage(
        `Facts already recorded (reuse these keys when the answer concerns them):\n` +
          `${asUntrustedData('known facts', knownFactsBlock(state.profileJson))}\n\n` +
          `${canonicalKeysBlock(state)}\n\n` +
          `Question asked: ${state.currentQuestion}\n\n${asUntrustedData(
            'User answer',
            userAnswer,
          )}\n\nExtract structured facts as JSON:`,
      ),
    ]);

    const raw =
      typeof response.content === 'string'
        ? response.content
        : (response.content[0] as { text: string }).text;

    let extracted: Record<string, unknown> = {};
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) extracted = JSON.parse(match[0]);
    } catch {
      // Non-parseable — skip, don't crash
    }

    if (
      !extracted ||
      typeof extracted !== 'object' ||
      Array.isArray(extracted)
    ) {
      return { profileJson: {} };
    }
    const profile = state.profileJson ?? {};
    return {
      profileJson: mergeProfileUpdate(
        profile,
        alignFactAliases(profile, extracted, state),
      ),
    };
  };
}
