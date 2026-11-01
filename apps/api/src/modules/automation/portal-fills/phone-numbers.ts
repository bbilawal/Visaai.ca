import { toIso3 } from './country-names';

/**
 * Where a telephone number goes on IRCC's telephone questions, recorded on
 * the live portal: the location radio `telLocation_<group>` answers
 * "Canada or the U.S." (-01, then `#telNumber_<group>` takes the ten digits)
 * or "Other" (-02, which reveals `#telCountryCode_<group>` for the
 * international dialling code — digits, "92" — and then `#telNumber_<group>`
 * for the national number).
 *
 * Applicants come from every country. Until 2026-10-18 any 10- or 11-digit
 * number was taken for a Canada / US one: an Indian 9876543210, a Mexican
 * 5512345678 or a Vietnamese 0912345678 went in as North American, and a
 * Chinese 13812345678 or Brazilian 11987654321 lost its leading 1. A number
 * is now North American only with an explicit +1 / 001, or when it has the
 * North American shape AND its owner lives in Canada or the US. Otherwise it
 * is an "Other" number, its code from an explicit +CC / 00CC or else the
 * owner's country. Neither known: undefined, and the applicant enters it.
 */
export type PhoneLocation = 'Canada or the U.S.' | 'Other';

export interface PlacedPhone {
  location: PhoneLocation;
  /** International dialling code, digits only ("92"); only for "Other". */
  countryCode?: string;
  /** NA: the ten digits. Other: the national number, no trunk 0. */
  number: string;
  /**
   * An extension written after the number ("ext 12"), digits only. Kept
   * apart: merged into the digits it would make a different number
   * (matrix C row 61).
   */
  extension?: string;
}

/** "… ext 12" / "… x45" / "…, extension 678" at the end of a number. */
const EXTENSION = /[\s,;]*(?:ext\.?|extn\.?|extension|x|#)\s*(\d{1,6})\s*$/i;

/** The number without a trailing extension, and the extension's digits. */
export function splitPhoneExtension(raw: string): {
  number: string;
  extension?: string;
} {
  const m = EXTENSION.exec(raw);
  if (!m || m.index === 0) return { number: raw };
  return { number: raw.slice(0, m.index).trim(), extension: m[1] };
}

/** NANP: area code and exchange each start 2-9. */
const NANP = /^[2-9]\d{2}[2-9]\d{6}$/;

/**
 * Every assigned ITU-T E.164 country calling code. The set is prefix-free, so
 * an explicit "+923001234567" splits into 92 + 3001234567 without guessing.
 */
const CALLING_CODES = new Set(
  (
    '1 7 20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 ' +
    '56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98 ' +
    '211 212 213 216 218 220 221 222 223 224 225 226 227 228 229 230 231 232 ' +
    '233 234 235 236 237 238 239 240 241 242 243 244 245 246 247 248 249 250 ' +
    '251 252 253 254 255 256 257 258 260 261 262 263 264 265 266 267 268 269 ' +
    '290 291 297 298 299 350 351 352 353 354 355 356 357 358 359 370 371 372 ' +
    '373 374 375 376 377 378 379 380 381 382 383 385 386 387 389 420 421 423 ' +
    '500 501 502 503 504 505 506 507 508 509 590 591 592 593 594 595 596 597 ' +
    '598 599 670 672 673 674 675 676 677 678 679 680 681 682 683 685 686 687 ' +
    '688 689 690 691 692 800 808 850 852 853 855 856 870 878 880 881 882 883 ' +
    '886 888 960 961 962 963 964 965 966 967 968 970 971 972 973 974 975 976 ' +
    '977 979 992 993 994 995 996 998'
  ).split(' '),
);

/**
 * Calling code by ISO-3 country, for the countries VisaAI's applicants most
 * often live in. A country missing here is not guessed: its number is left
 * for the applicant unless they wrote it with +CC.
 */
export const COUNTRY_CALLING_CODES: Readonly<Record<string, string>> = {
  CAN: '1',
  USA: '1',
  MEX: '52',
  BRA: '55',
  ARG: '54',
  CHL: '56',
  COL: '57',
  PER: '51',
  VEN: '58',
  ECU: '593',
  CUB: '53',
  GBR: '44',
  IRL: '353',
  FRA: '33',
  DEU: '49',
  ITA: '39',
  ESP: '34',
  PRT: '351',
  NLD: '31',
  BEL: '32',
  CHE: '41',
  AUT: '43',
  SWE: '46',
  NOR: '47',
  DNK: '45',
  FIN: '358',
  POL: '48',
  ROU: '40',
  UKR: '380',
  RUS: '7',
  TUR: '90',
  GRC: '30',
  PAK: '92',
  IND: '91',
  BGD: '880',
  LKA: '94',
  NPL: '977',
  AFG: '93',
  IRN: '98',
  IRQ: '964',
  SAU: '966',
  ARE: '971',
  QAT: '974',
  KWT: '965',
  OMN: '968',
  BHR: '973',
  JOR: '962',
  LBN: '961',
  SYR: '963',
  ISR: '972',
  EGY: '20',
  MAR: '212',
  DZA: '213',
  TUN: '216',
  NGA: '234',
  GHA: '233',
  KEN: '254',
  ETH: '251',
  ZAF: '27',
  CMR: '237',
  SEN: '221',
  CIV: '225',
  UGA: '256',
  TZA: '255',
  ZWE: '263',
  CHN: '86',
  HKG: '852',
  TWN: '886',
  JPN: '81',
  KOR: '82',
  PHL: '63',
  VNM: '84',
  THA: '66',
  MYS: '60',
  SGP: '65',
  IDN: '62',
  KHM: '855',
  MMR: '95',
  AUS: '61',
  NZL: '64',
};

const NORTH_AMERICA = new Set(['CAN', 'USA']);

/** Split "92300…" into a known calling code and the rest. */
function splitCallingCode(
  digits: string,
): { code: string; rest: string } | undefined {
  for (const n of [1, 2, 3]) {
    const code = digits.slice(0, n);
    if (CALLING_CODES.has(code)) return { code, rest: digits.slice(n) };
  }
  return undefined;
}

/**
 * The national number IRCC wants after the code: no trunk 0 ("0300…" is
 * dialled from abroad as 92 300…). Italy keeps its leading 0 internationally.
 */
function nationalNumber(code: string, digits: string): string {
  return code === '39' ? digits : digits.replace(/^0+/, '');
}

function placedOther(code: string, digits: string): PlacedPhone | undefined {
  const number = nationalNumber(code, digits);
  // E.164 caps a number at 15 digits including the code; anything under 4
  // national digits is not a phone number.
  if (number.length < 4 || code.length + number.length > 15) return undefined;
  return { location: 'Other', countryCode: code, number };
}

function placedNorthAmerican(digits: string): PlacedPhone | undefined {
  const d =
    digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return NANP.test(d)
    ? { location: 'Canada or the U.S.', number: d }
    : undefined;
}

/**
 * Place one phone number on IRCC's telephone question.
 *
 * @param raw what the person typed ("+92 300 1234567", "(905) 226-5664").
 * @param owner.country where the number's owner lives (any country form).
 * @param owner.countryCode a dialling code recorded beside the number (the
 *   Forms page keeps `telephone_country_code` apart from the number).
 */
export function placePhone(
  raw: string | undefined,
  owner: { country?: string; countryCode?: string } = {},
): PlacedPhone | undefined {
  if (!raw || !raw.trim()) return undefined;
  const { number, extension } = splitPhoneExtension(raw.trim());
  const placed = placeNumber(number, owner);
  return placed && extension ? { ...placed, extension } : placed;
}

function placeNumber(
  raw: string,
  owner: { country?: string; countryCode?: string },
): PlacedPhone | undefined {
  // "+44 (0)20 …": the bracketed trunk 0 is never dialled from abroad.
  const text = raw.replace(/\(\s*0\s*\)/g, ' ').trim();

  // 1. An explicit international prefix in the number itself.
  const intl = /^(?:\+|00)\s*(.*)$/.exec(text);
  if (intl) {
    const split = splitCallingCode(intl[1].replace(/\D/g, ''));
    if (!split) return undefined;
    return split.code === '1'
      ? placedNorthAmerican(split.rest)
      : placedOther(split.code, split.rest);
  }
  const digits = text.replace(/\D/g, '');
  if (!digits) return undefined;

  // 2. A dialling code recorded beside the number.
  const given = owner.countryCode?.replace(/\D/g, '');
  if (given) {
    if (!CALLING_CODES.has(given)) return undefined;
    return given === '1'
      ? placedNorthAmerican(digits)
      : placedOther(given, withoutCode(given, digits));
  }

  // 3. The owner's country.
  const iso3 = owner.country ? toIso3(owner.country) : null;
  if (!iso3) return undefined;
  if (NORTH_AMERICA.has(iso3)) return placedNorthAmerican(digits);
  const code = COUNTRY_CALLING_CODES[iso3];
  return code ? placedOther(code, withoutCode(code, digits)) : undefined;
}

/**
 * "923001234567" written without its "+": the calling code is already in the
 * digits (review 2026-10-18 — it was entered as +92 923001234567). Stripped
 * only when what remains is still a full national number, so a 10-digit
 * Indian 9198765432 keeps its leading 91.
 */
function withoutCode(code: string, digits: string): string {
  return digits.startsWith(code) &&
    digits.length >= 11 &&
    digits.length - code.length >= 8
    ? digits.slice(code.length)
    : digits;
}

/** "+92 3001234567" / "9052265664", for a row summary. */
export function phoneSummary(p: PlacedPhone): string {
  return p.countryCode ? `+${p.countryCode} ${p.number}` : p.number;
}
