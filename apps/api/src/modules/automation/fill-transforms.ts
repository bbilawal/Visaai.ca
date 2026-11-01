import type {
  FillFieldMapping,
  FillTransform,
} from '../../strategies/portal-integration/portal-fill.registry';
import {
  IRCC_COUNTRY_CODES,
  IRCC_UK_NATIONALITY_CODES,
} from './portal-fills/ircc-country-codes';
import { mrzNationalityVariant, toIso3 } from './portal-fills/country-names';
import { placePhone } from './portal-fills/phone-numbers';
import { irccMedicalNumber } from './portal-fills/ircc-profile';
import {
  ETA_MONTHS,
  etaCountryCodeOption,
  etaNationalityOption,
  etaPlaceOption,
} from './portal-fills/eta-options';

/**
 * The IRCC secure-account questionnaire's month option values, January to
 * December (recorded live 2026-10-20). Not in calendar order.
 */
export const EAPP_MONTH_CODES = [
  '1819',
  '1818',
  '1822',
  '1827',
  '1823',
  '1821',
  '1820',
  '1816',
  '1826',
  '1825',
  '1824',
  '1817',
] as const;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+Z?)?$/;
const YEAR_ONLY_DATE = /^(\d{4})-Unknown-Unknown$/;
const YEAR_MONTH_DATE = /^(\d{4})-(0[1-9]|1[0-2])-Unknown$/;

/**
 * Free text reduced to what IRCC's punctuation-refusing boxes accept: ASCII
 * letters, digits and single spaces. "&" reads "and"; accents are dropped
 * ("café" → "cafe"); every other character becomes a space. With `max`, cut
 * at the last whole word that fits. undefined when nothing is left.
 */
export function plainWords(raw: string, max?: number): string | undefined {
  let t = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim();
  if (max != null && t.length > max) {
    const cut = t.slice(0, max + 1);
    const sp = cut.lastIndexOf(' ');
    t = (sp > 0 ? cut.slice(0, sp) : t.slice(0, max)).trim();
  }
  return /[A-Za-z0-9]/.test(t) ? t : undefined;
}

/**
 * IRCC tr-rt's GenericEnglishFrench pattern (tr-rt main.js, read 2026-10-20):
 * the characters its free-text boxes accept. Anything else fails the field
 * ("Only characters from the Roman script/alphabet can be entered on this
 * field", live 2026-10-30 on "B1/B2").
 */
export const IRCC_GENERIC_TEXT =
  /^[a-zA-ZáàâäéèêëíìîïóòôöúùûüçÁÀÂÄÉÈÊËÍÌÎÏÓÒÔÖÚÙÛÜÇŒœŸÿ \d\s\-#.,()'&@:;"]+$/;
const IRCC_GENERIC_CHAR =
  /[a-zA-ZáàâäéèêëíìîïóòôöúùûüçÁÀÂÄÉÈÊËÍÌÎÏÓÒÔÖÚÙÛÜÇŒœŸÿ \d\s\-#.,()'&@:;"]/;
/** Latin letters NFD does not split into a base letter and an accent. */
const LATIN_PLAIN: Record<string, string> = {
  Ł: 'L', ł: 'l', ß: 'ss', Ø: 'O', ø: 'o', Æ: 'AE', æ: 'ae', Đ: 'D', đ: 'd',
  Þ: 'Th', þ: 'th', ı: 'i',
};

/**
 * Free text as IRCC tr-rt's boxes accept it. "/" reads " or " ("B1/B2" →
 * "B1 or B2"), or "-" between digits ("10/2023" → "10-2023"); typographic
 * dashes and quotes become plain; an accented letter IRCC does not list loses
 * its accent; any other character becomes a space. undefined when nothing
 * readable is left.
 */
export function irccRomanText(raw: string): string | undefined {
  const t = raw
    .replace(/[–—‒−]/g, '-')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/(\d)\s*\/\s*(?=\d)/g, '$1-')
    .replace(/([^\s/])\s*\/\s*(?=[^\s/])/g, '$1 or ')
    .replace(/\//g, ' ');
  const out = Array.from(t)
    .map((ch) => {
      if (IRCC_GENERIC_CHAR.test(ch)) return ch;
      if (LATIN_PLAIN[ch]) return LATIN_PLAIN[ch];
      const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return base && Array.from(base).every((c) => IRCC_GENERIC_CHAR.test(c))
        ? base
        : ' ';
    })
    .join('')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +$/gm, '')
    .replace(/^ +/gm, '')
    .trim();
  return /[A-Za-z0-9]/.test(out) ? out : undefined;
}

/** Apply a mapping's transform to a raw profile value; null = do not write. */
export function applyFillTransform(
  transform: FillTransform | undefined,
  raw: string,
): string | null {
  if (!transform) return raw;
  if (transform === 'ircc_country') {
    // A BN(O) / BOTC / BOC passport is GBR as a country but not "British
    // Citizen" (003) as a nationality.
    const uk = mrzNationalityVariant(raw);
    if (uk) return IRCC_UK_NATIONALITY_CODES[uk] ?? null;
    const iso3 = toIso3(raw);
    return iso3 ? (IRCC_COUNTRY_CODES[iso3] ?? null) : null;
  }
  if (transform === 'strip_dashes') {
    // IRCC: "letters, numbers and spaces with no special characters". Every
    // other character goes, not just dashes: Brazil's CPF 123.456.789-09,
    // Colombia's 1.234.567.890 and Hong Kong's A1234567(8) used to come out
    // null, and IRCC showed "Yes, I have a national ID" with the number empty
    // (audit 2026-10-18). CNIC 37405-5309209-7 → 3740553092097 as before.
    const v = raw
      .replace(/[^A-Za-z0-9 ]/g, '')
      .replace(/ {2,}/g, ' ')
      .trim();
    return /[A-Za-z0-9]/.test(v) ? v : null;
  }
  if (transform === 'whole_number') {
    const t = raw
      .replace(/,/g, '')
      .replace(/[^\d.]/g, ' ')
      .trim()
      .split(/\s+/)[0];
    if (!t || !/^\d+(\.\d+)?$/.test(t)) return null;
    return String(Math.round(Number(t)));
  }
  if (transform === 'na_phone') {
    // IRCC's Canada / US number field takes the ten digits only. The
    // interview stores what the applicant typed ("+1 905-226-5664"). Whether
    // a number IS North American is decided with its owner's country by the
    // location radio this field follows (portal-fills/phone-numbers.ts), so a
    // Chinese 13812345678 never reaches this field. Here only a NANP-shaped
    // number passes, with or without its 1 / +1 / 001: any other +CC or a
    // trunk-0 number (Vietnam 0912345678) writes nothing (audit 2026-10-18).
    const placed = placePhone(raw, { country: 'CAN' });
    return placed?.location === 'Canada or the U.S.' ? placed.number : null;
  }
  if (transform === 'eta_country_code') return etaCountryCodeOption(raw);
  if (transform === 'eta_nationality') return etaNationalityOption(raw);
  if (transform === 'eta_place_country') return etaPlaceOption(raw);
  if (transform === 'ircc_medical_number')
    return irccMedicalNumber(raw) ?? null;
  if (transform === 'plain_words') return plainWords(raw) ?? null;
  if (transform === 'ircc_text') return irccRomanText(raw) ?? null;
  if (transform === 'digits') {
    const v = raw.replace(/\D/g, '');
    return v === '' ? null : v;
  }
  // A date known only to the year: IRCC's date selects carry an "Unknown"
  // month and day option (portal-fills/canada-ircc.ts, children).
  const y = YEAR_ONLY_DATE.exec(raw.trim());
  if (y) {
    if (transform === 'date_year') return y[1];
    // The eTA date selects have no "Unknown" option.
    if (
      transform === 'date_month_name' ||
      transform === 'date_day_padded' ||
      transform === 'eapp_month'
    )
      return null;
    return 'Unknown';
  }
  // Known to the month: the day is "Unknown" (live 2026-10-30, parents).
  const ym = YEAR_MONTH_DATE.exec(raw.trim());
  if (ym) {
    if (transform === 'date_year') return ym[1];
    if (transform === 'date_month') return ym[2];
    if (transform === 'eapp_month')
      return EAPP_MONTH_CODES[Number(ym[2]) - 1] ?? null;
    if (transform === 'date_month_name')
      return ETA_MONTHS[Number(ym[2]) - 1] ?? null;
    if (transform === 'date_day') return 'Unknown';
    return null;
  }
  const m = ISO_DATE.exec(raw.trim());
  if (!m) return null;
  if (transform === 'date_year') return m[1];
  if (transform === 'date_month') return m[2];
  if (transform === 'eapp_month')
    return EAPP_MONTH_CODES[Number(m[2]) - 1] ?? null;
  if (transform === 'date_month_name')
    return ETA_MONTHS[Number(m[2]) - 1] ?? null;
  // eTA day option text is zero-padded ("01").
  if (transform === 'date_day_padded') return m[3];
  return String(Number(m[3])); // date_day: "05" → "5"
}

function rawValue(
  field: FillFieldMapping,
  p: Record<string, unknown>,
): unknown {
  // An answer-type write (radio, checkbox, option by text) is always read
  // through its derivation, which reads the mapping's own key first and turns
  // true / "no" / "married" into the portal's answer.
  if (
    field.derive &&
    field.op &&
    field.op !== 'dialog_open' &&
    field.op !== 'dialog_save'
  )
    return field.derive(p);
  // A value stored under the mapping's own key wins, even blank: that is the
  // saved form (or a consultant's correction) speaking.
  if (Object.prototype.hasOwnProperty.call(p, field.profileKey)) {
    const v = p[field.profileKey];
    // A structured answer (a list of refusal records, say) is not the text a
    // portal box takes; the mapping's derivation knows how to write it.
    // A list of plain values (a dual national's ['PAK', 'GBR']) is not one,
    // and keeps the old behaviour: nothing is guessed from it.
    const structured =
      typeof v === 'object' &&
      v !== null &&
      (!Array.isArray(v) || v.some((x) => typeof x === 'object' && x !== null));
    if (v != null && !(structured && field.derive)) return v;
  }
  return field.derive ? field.derive(p) : undefined;
}

/**
 * The value a mapping writes for this profile, or null when it writes nothing:
 * its `requires` gate is off, the value is empty, the transform cannot read
 * it, or it is longer than the portal accepts. Shared by the fill and
 * preflight builders so they cannot disagree.
 */
export function resolveFillValue(
  field: FillFieldMapping,
  p: Record<string, unknown>,
): string | null {
  if (field.requires && !p[field.requires]) return null;
  if (field.onlyIf && !field.onlyIf(p)) return null;
  const raw = rawValue(field, p);
  if (raw == null || raw === '') return null;
  // Lists and records are never a value.
  if (
    typeof raw !== 'string' &&
    typeof raw !== 'number' &&
    typeof raw !== 'boolean'
  )
    return null;
  const value = applyFillTransform(field.transform, String(raw));
  if (value == null || value === '') return null;
  if (field.maxLength != null && value.length > field.maxLength) return null;
  return value;
}
