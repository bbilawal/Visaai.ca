import {
  DEPARTURE_DATE_KEYS,
  ENTRY_DATE_KEYS,
  intakeFactSpecs,
  missingIntakeFacts,
} from '@visaai/types';
import type { IntakeState } from '../intake.state';
import { routeVisaaiId } from './check-complete';

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
  const lines = missing.map((s) => `- ${s.question}`);
  return `REQUIRED BY THE OFFICIAL APPLICATION FORM — STILL UNANSWERED:
${lines.join('\n')}

Ask these, ONE per turn, in the order listed, before anything optional. Do not tell the applicant the interview is finished, and do not hand off to the Documents page as a final step, while any of them is unanswered. Dates must be exact calendar dates.`;
}

/** Block for the extractor prompt: the canonical key for each required fact. */
export function canonicalKeysBlock(
  state: Pick<IntakeState, 'destinationCountry' | 'requirementsJson'>,
): string {
  const specs = intakeFactSpecs(routeOf(state)).filter(
    (s) => s.key !== 'duration_of_stay_days',
  );
  const lines = specs.map((s) => `- ${s.key}: ${s.question}`);
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
