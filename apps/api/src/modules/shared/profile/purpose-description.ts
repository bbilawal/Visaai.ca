import {
  formatLongDate,
  intakeAnswerIsYes,
  plannedStay,
  stayLengthPhrase,
} from '@visaai/types';

/**
 * The purpose-of-visit TEXT a government form receives, composed from the
 * profile.
 *
 * The intake stores the purpose as the applicant said it — "family visit". An
 * officer reading IRCC's purpose box expects a description with the dates of
 * the trip, and the dry run (2026-10-14, #51) locked the bare phrase for
 * auto-fill. This composes, deterministically, e.g.:
 *
 *   Family visit from March 1, 2027 to April 30, 2027 (61 days): visiting my
 *   son Ahmed Khan in Toronto. I will return home on April 30, 2027.
 *
 * Deterministic on purpose: the preflight lock is a hash over the mapped
 * values, so the text a consultant reviews must be reproducible from server
 * state. A model call here would make every re-derivation a different string.
 *
 * The duration is derived from the dates (stay-dates.ts), never read from a
 * stored day count (#20).
 */

const PURPOSE_KEYS = [
  'purpose_of_visit',
  'purpose',
  'visit_purpose',
  'purpose_of_travel',
  'trip_purpose',
  'reason_for_visit',
  'travel_purpose',
];

const DETAIL_KEYS = [
  'purpose_details',
  'purpose_of_visit_details',
  'visit_details',
  'purpose_description',
];

const RELATIONSHIP_KEYS = [
  'relationship_to_family_in_destination',
  'relationship_to_host',
  'host_relationship',
];

const HOST_NAME_KEYS = [
  'family_member_name',
  'family_in_destination_name',
  'host_name',
  'inviter_name',
];

const CITY_KEYS = [
  'destination_city',
  'city_of_stay',
  'host_city',
  'city_to_visit',
];

function str(profile: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = profile[k];
    if (
      typeof v === 'string' &&
      v.trim() &&
      intakeAnswerIsYes(v) === undefined
    ) {
      return v.trim();
    }
  }
  return null;
}

/** Does the text already state the trip's dates (ISO or long form)? */
function mentionsDates(
  text: string,
  entry: string,
  departure: string,
): boolean {
  return [
    entry,
    departure,
    formatLongDate(entry),
    formatLongDate(departure),
  ].some((d) => text.includes(d));
}

function sentenceCase(s: string): string {
  const t = s.trim().replace(/[.\s]+$/, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function detailOf(profile: Record<string, unknown>): string | null {
  const explicit = str(profile, DETAIL_KEYS);
  if (explicit) return explicit.replace(/[.\s]+$/, '');
  const relationship = str(profile, RELATIONSHIP_KEYS);
  const host = str(profile, HOST_NAME_KEYS);
  const city = str(profile, CITY_KEYS);
  if (!relationship && !host) return null;
  let out = 'visiting';
  if (relationship) out += ` my ${relationship.toLowerCase()}`;
  if (host) out += ` ${host}`;
  if (city) out += ` in ${city}`;
  return out;
}

/**
 * The composed description, or:
 *  - the phrase unchanged when the dates are not both known (nothing to add),
 *  - the phrase unchanged when it already states the dates (someone wrote it),
 *  - null when there is no purpose at all.
 *
 * `phrase` overrides the profile's purpose — pass the reviewed form value when
 * there is one, so the applicant's edit is what gets composed.
 */
export function composePurposeOfVisit(
  profile: Record<string, unknown> | null | undefined,
  phrase?: string | null,
): string | null {
  const p = profile ?? {};
  const purpose =
    typeof phrase === 'string' && phrase.trim()
      ? phrase.trim()
      : str(p, PURPOSE_KEYS);
  if (!purpose) return null;

  const stay = plannedStay(p);
  if (!stay.entryDate || !stay.departureDate || stay.days === null)
    return purpose;
  if (mentionsDates(purpose, stay.entryDate, stay.departureDate))
    return purpose;

  const from = formatLongDate(stay.entryDate);
  const to = formatLongDate(stay.departureDate);
  // A detail that only repeats the phrase ("Business; meeting suppliers…"
  // after "Business visit to X for meeting suppliers…") adds nothing.
  const rawDetail = detailOf(p);
  const core = rawDetail
    ?.replace(/^[a-z ]{2,30}[;:]\s*/i, '')
    .trim()
    .toLowerCase();
  // Only a substantial repeat (three words or more, whole words) counts.
  const repeats =
    !!core &&
    core.split(/\s+/).length >= 3 &&
    new RegExp(`\\b${core.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(
      purpose.toLowerCase(),
    );
  const detail = rawDetail && repeats ? null : rawDetail;
  // A short visit is a day count; a long stay (a super visa year) is months.
  const length =
    stayLengthPhrase(stay.entryDate, stay.departureDate) ??
    `${stay.days} day${stay.days === 1 ? '' : 's'}`;
  const head = `${sentenceCase(purpose)} from ${from} to ${to} (${length})`;
  return `${head}${detail ? `: ${detail}` : ''}. I will return home on ${to}.`;
}
