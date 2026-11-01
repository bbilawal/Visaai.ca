import { mrzNationalityVariant, toIso3 } from './country-names';
import {
  ETA_CODE_OPTIONS,
  ETA_NATIONALITY_OPTIONS,
  ETA_PLACE_OPTIONS,
} from './eta-country-lists';

/**
 * Option TEXT of the IRCC eTA form's country selects, as recorded live on
 * 2026-10-16. The form chooses every answer from a <select> whose option
 * values are list indexes, so the text is the only stable handle — and each
 * field has its own list:
 *
 *  - code list (country of citizenship on the passport): "PAK (Pakistan)",
 *    "GBR (UK - British citizen)";
 *  - nationality list (nationality noted on the passport): "Pakistan",
 *    "UK - British citizen";
 *  - place list (country of birth, address country): "Pakistan", "England" —
 *    the UK appears by nation, there is no "United Kingdom".
 *
 * Every option of the three lists was read from the live form (2026-10-18)
 * and is keyed by alpha-3 in eta-country-lists.ts. A country with no option
 * (a territory, a former state, an unknown spelling) resolves to nothing: the
 * field is not written and the applicant chooses it.
 */
const CODE_LIST = ETA_CODE_OPTIONS;
const NATIONALITY_LIST = ETA_NATIONALITY_OPTIONS;
/** GBR is deliberately absent: which UK nation is not ours to guess. */
const PLACE_LIST = ETA_PLACE_OPTIONS;

/**
 * UK nations on the place list, matched by the name the profile gives.
 * "England" was read on the live form; the other three nations are the same
 * list's entries for the rest of the UK (the list has no "United Kingdom").
 */
const PLACE_NATIONS: Readonly<Record<string, string>> = {
  england: 'England',
  scotland: 'Scotland',
  wales: 'Wales',
  'northern ireland': 'Northern Ireland',
};

export function etaCountryCodeOption(raw: string): string | null {
  // GBN / GBO / GBD… are UK passports, but not "UK - British citizen".
  if (mrzNationalityVariant(raw)) return null;
  const iso = toIso3(raw);
  return iso ? (CODE_LIST[iso] ?? null) : null;
}

export function etaNationalityOption(raw: string): string | null {
  if (mrzNationalityVariant(raw)) return null;
  const iso = toIso3(raw);
  return iso ? (NATIONALITY_LIST[iso] ?? null) : null;
}

/** "Leeds, England" → "England"; "Pakistan" → "Pakistan"; "United Kingdom" → null. */
export function etaPlaceOption(raw: string): string | null {
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last) return null;
  const nation = PLACE_NATIONS[last.toLowerCase()];
  if (nation) return nation;
  const iso = toIso3(last);
  return iso ? (PLACE_LIST[iso] ?? null) : null;
}

export const ETA_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
