import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { IntakeState, ProfileChange } from '../intake.state';
import {
  asUntrustedData,
  UNTRUSTED_DATA_DIRECTIVE,
} from '../../../shared/ai/untrusted';
import { mergeProfileUpdate } from '../../../shared/profile/family-members';
import {
  childrenUpdate,
  withoutRemovedChildFacts,
} from '../../../shared/profile/intake-children';
import { statedNationality } from '../../../shared/profile/stated-nationality';
import {
  alignFactAliases,
  canonicalKeysBlock,
  routeFactKeys,
  withoutUnaskedDeclarations,
} from './required-facts';
import {
  canonicalizeFactKeys,
  routeSecondInviter,
} from '../../../shared/profile/canonical-fact-keys';
import { NATIONALITY_KEYS } from '@visaai/types';
import { withVolunteeredFacts } from './volunteered-facts';
import { withStatedOtherNames } from './stated-other-names';

const EXTRACT_PROMPT = `You are extracting structured data from a user's answer to a visa application interview question.
Return ONLY a JSON object with the extracted facts. Use snake_case keys.
Examples of keys: employed, employer_name, monthly_salary_usd, has_property, property_country, travel_history_countries, family_in_destination, purpose_of_visit, duration_of_stay_days.
ALWAYS record the applicant's own nationality whenever the answer states it —
at any stage, whatever question was asked: "nationality" (the country of
citizenship, e.g. "Pakistan") and, when a passport is mentioned,
"passport_country". Nationality decides which visa route the applicant may use.
Never record a relative's citizenship or residence status as the applicant's.
If the answer doesn't contain extractable facts, return {}.
Never include the question itself in the output.

REUSING KEYS IS THE POINT. The facts already recorded are listed below. When the
answer concerns a fact that is already there — including when the user is
CORRECTING it — return that EXACT key with the new value. Inventing a second key
for the same fact does not add information: it leaves both the old value and the
new one in the record, and whatever reads it later cannot tell which the user
meant.

Only invent a key when the fact is genuinely new.

An answer often gives more than the question asked. Record EVERY fact the answer gives, not only the one asked — each under its canonical key. "No TB diagnosis, and I have not been in close contact with anyone with TB" answers both tuberculosis (false) and tuberculosis_contact (false); "me@x.com, phone +92 300 1234567 (mobile)" answers email, phone_number and phone_type ("cell"). A fact you drop is asked again.

Two specific traps:
- A currency belongs in the key only if you know it. Do not copy an amount into
  both a _usd and a _cad key; use the one the user actually stated.
- A corrected date replaces the old date under the old key. Do not add
  "intended_", "corrected_" or "actual_" variants.

People (children, siblings, spouse, parents, other family members) are lists of
objects that ALWAYS carry each person's "name". When an answer adds or changes
a detail about one person, return that person's object with their name — never
an unnamed list ordered by position.

Children (sons and daughters, wherever they live — including one the applicant
is visiting) ALWAYS go in the "children" list, one object per child:
  {"name": "..." (the FULL name: given names then family name),
   "given_name": "...", "family_name": "..." (whenever the applicant says which
     part is the family name / surname and which are the given names — keep
     "name" as well),
   "relationship": "son" | "daughter", "sex": "Male" | "Female",
   "date_of_birth": "YYYY-MM-DD" (ONLY when the full date is known),
   "birth_year": 2000 (when only the year is known),
   "country_of_birth": "...",
   "marital_status": "Single" | "Married" | "Common-law" | "Divorced" | "Widowed" | ...,
   "in_home_country": true | false, "country_of_residence": "...",
   "same_address": true | false (lives with the applicant at their address),
   "accompanying": true | false (coming to Canada / the destination with the
     applicant on this application),
   "occupation": "..."}
Never invent flat child keys such as youngest_son_name, other_son_name,
son_occupation, child_1_name or family_member_name: the forms read only
"children". Return only the children the answer is about; they are merged into
the existing list by name. When an answer gives a child's name in parts, also
use the name already recorded for that child (or the full name) in "name" so
the child is matched, not added twice.

"in_home_country" and "country_of_residence" say where the child lives NOW.
A child who will travel with the applicant, accompany them, or come to Canada
is "accompanying": true — that NEVER changes "in_home_country". Change where a
child lives only when the applicant says the child lives somewhere else, and
then give "country_of_residence" too.

Answers that are lists of children's NAMES — "children_living_with_you",
"children_accompanying" — are arrays of name strings. Return only the names
the answer is about: they are ADDED to the names already recorded, never
replace them. To take a name off such a list, return {"name": "...", "remove":
true} in it. When the applicant restates such a list with "only" or "just"
("only Ali lives with me"), return {"name": "...", "remove": true} for every
child already in the list who is no longer in it. When the applicant says a
child lives with them or is coming with them, record it BOTH on the child
("same_address" / "accompanying") and in the list.

The HOST's household is not the applicant's children. On a super visa the host
(the applicant's child or grandchild in Canada) lists the people in the host's household — the host,
their spouse, their children (the applicant's grandchildren), the applicant — and they go in
"host_household_members" ({"name", "date_of_birth", "relationship_to_host"}), never in "children".

Where a child lives is not where the applicant lives. Record
"children_living_with_you" (and a child's "same_address": true) ONLY when the
applicant says that child lives with them, at their own home address. A child
who lives in the same city or country with their own family ("my son and his
family live in Rawalpindi") is "in_home_country": true with a
"country_of_residence" — never in children_living_with_you.

Fixed key names, whatever the route:
- the applicant's own place of birth (city or town, "City, Country" when the
  country is known) is "place_of_birth" — never birthplace_city, birth_city or
  city_of_birth;
- the applicant's own occupation (employed, homemaker, retired, …) is
  "occupation" — never current_occupation or current_job.

The primary inviter (host) and a SECOND inviter are two different people.
"inviter_name", "inviter_address", "inviter_phone", "inviter_email",
"inviter_relationship" and the other inviter_*/host_* keys belong ONLY to the
primary inviter already recorded. When the question asks whether anyone else
(a second person) is also inviting the applicant, or the answer names a
different person as an inviter or co-signer, record that person under
"has_second_inviter": true, "second_inviter_name", "second_inviter_address",
"second_inviter_phone", "second_inviter_email" and
"second_inviter_relationship" — never under inviter_* or host_*, which would
overwrite the primary inviter's details with someone else's.

Other names ("other_names"): record ONLY the names the applicant says they
use or used instead of their current name — "sometimes written as X", "also
known as X" (kind "alias"), "previously called X" (kind "previous name"),
"maiden name X" (kind "name before marriage"). The applicant's own current or
passport name, given in the same answer to show how the other name differs,
is NEVER an other name.

Removing a child: when the applicant says a child is not theirs, was added by
mistake, or should be removed, return that child with "remove": true —
{"children": [{"name": "...", "remove": true}]}. Never drop a child by leaving
him out of the list; a list that omits someone changes nothing.

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
  // `_`-prefixed keys are bookkeeping (document provenance), not facts; a
  // removed child's leftover keys are no longer facts either.
  const entries = Object.entries(
    withoutRemovedChildFacts(profile ?? {}),
  ).filter(([k]) => !k.startsWith('_'));
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
    // Every exit resets `profileChanges`: a turn that extracted nothing must
    // not be confirmed with the previous turn's changes.
    if (!lastMessage || lastMessage.getType() !== 'human')
      return { profileChanges: [] };

    const userAnswer =
      typeof lastMessage.content === 'string' ? lastMessage.content : '';

    if (!userAnswer.trim()) return { profileChanges: [] };

    // JSON mode: the reply must be one JSON object. A reply that was anything
    // else (a fenced block followed by a note) was read as "no facts" — the
    // super visa correction of 2026-10-16 was answered "No changes were
    // recorded" and the row was rewritten unchanged.
    const response = await llm.invoke(
      [
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
      ],
      { response_format: { type: 'json_object' } },
    );

    const raw =
      typeof response.content === 'string'
        ? response.content
        : (response.content[0] as { text: string }).text;

    const parsed = parseExtraction(raw);
    if (parsed === null && raw.trim()) {
      // Never silent again: a reply we cannot read loses the applicant's
      // answer. Length only — the content is the applicant's data.
      console.warn('[intake:process-answer] unreadable extraction', {
        applicationId: state.applicationId,
        chars: raw.length,
      });
    }
    let extracted: Record<string, unknown> = parsed ?? {};
    extracted = withDerivedFacts(extracted);

    if (
      !extracted ||
      typeof extracted !== 'object' ||
      Array.isArray(extracted)
    ) {
      return { profileJson: {}, profileChanges: [] };
    }
    const profile = state.profileJson ?? {};
    withStatedNationality(extracted, userAnswer);
    extracted = withVolunteeredFacts(state, extracted, userAnswer);
    // Never the applicant's own passport name as an other name (prod
    // 2026-10-30, app 945eb7f1), never any after a "No".
    extracted = withStatedOtherNames(extracted, userAnswer, profile);
    // One key per fact (birthplace_city → place_of_birth, …), then keep the
    // primary inviter's fields for the primary inviter (prod 2026-10-17).
    extracted = routeSecondInviter(
      profile,
      withoutUnaskedDeclarations(
        state,
        canonicalizeFactKeys(extracted, routeFactKeys(state)),
      ),
      state.currentQuestion,
    );
    const update = mergeProfileUpdate(
      profile,
      alignFactAliases(profile, extracted, state),
    );
    // Children named under ad-hoc flat keys land in `children`, the only list
    // the forms read. What the applicant said THIS turn may overwrite a
    // child's detail; flat keys left over from earlier turns only fill gaps.
    const folded = childrenUpdate(
      { ...profile, ...update },
      { fresh: new Set(Object.keys(update)) },
    );
    if (folded) Object.assign(update, folded);
    return {
      profileJson: update,
      profileChanges: changesBetween(profile, update),
    };
  };
}

/**
 * Fill the applicant's nationality from an explicit first-person statement
 * when the model's extraction carries none (prod 2026-10-16, app 5d3a17a4:
 * "I am a citizen of Pakistan with a Pakistani passport only." was stored
 * without any nationality, and the eTA gate let a Pakistani pick the eTA).
 * What the model did extract always wins; this only fills the gap.
 */
function withStatedNationality(
  extracted: Record<string, unknown>,
  answer: string,
): void {
  if (NATIONALITY_KEYS.some((k) => k in extracted)) return;
  const stated = statedNationality(answer);
  if (!stated) return;
  extracted.nationality = stated.nationality;
  if (stated.passport_country)
    extracted.passport_country = stated.passport_country;
}

/**
 * The extractor's reply as an object, or null when no object can be read.
 *
 * Tolerant on purpose: the whole reply, else a fenced block, else the first
 * balanced {...} (a greedy match from the first "{" to the LAST "}" swallowed
 * a trailing note containing braces and failed), each with trailing commas
 * forgiven.
 */
export function parseExtraction(raw: string): Record<string, unknown> | null {
  const candidates: string[] = [raw.trim()];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  if (fence) candidates.push(fence[1].trim());
  const balanced = firstBalancedObject(raw);
  if (balanced) candidates.push(balanced);
  for (const c of candidates) {
    for (const text of [c, c.replace(/,\s*([}\]])/g, '$1')]) {
      try {
        const v: unknown = JSON.parse(text);
        if (v && typeof v === 'object' && !Array.isArray(v))
          return v as Record<string, unknown>;
      } catch {
        // try the next reading
      }
    }
  }
  return null;
}

function firstBalancedObject(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return raw.slice(start, i + 1);
  }
  return null;
}

const DAY_MS = 86_400_000;

/**
 * Facts that follow from what was said. An immigration medical exam done on a
 * date in the last 12 months answers IRCC's "medical exam in the last 12
 * months" — left alone, a profile held the exam date next to a stale `false`.
 */
export function withDerivedFacts(
  extracted: Record<string, unknown>,
  now: Date = new Date(),
): Record<string, unknown> {
  const date = extracted.immigration_medical_exam_date;
  if (
    typeof date === 'string' &&
    !('medical_exam_last_12_months' in extracted)
  ) {
    const t = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
    if (!Number.isNaN(t) && t <= now.getTime()) {
      return {
        ...extracted,
        medical_exam_last_12_months: now.getTime() - t <= 365 * DAY_MS,
      };
    }
  }
  return extracted;
}

/** Each key of `update` whose value differs from what `before` holds. */
export function changesBetween(
  before: Record<string, unknown>,
  update: Record<string, unknown>,
): ProfileChange[] {
  const out: ProfileChange[] = [];
  for (const [key, to] of Object.entries(update)) {
    if (key.startsWith('_')) continue;
    const from = before[key];
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    out.push({ key, from: from ?? null, to });
  }
  return out;
}
