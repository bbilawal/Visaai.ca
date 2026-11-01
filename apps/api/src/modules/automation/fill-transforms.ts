import type {
  FillFieldMapping,
  FillTransform,
} from '../../strategies/portal-integration/portal-fill.registry';
import { IRCC_COUNTRY_CODES } from './portal-fills/ircc-country-codes';
import { toIso3 } from './portal-fills/country-names';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+Z?)?$/;

/** Apply a mapping's transform to a raw profile value; null = do not write. */
export function applyFillTransform(
  transform: FillTransform | undefined,
  raw: string,
): string | null {
  if (!transform) return raw;
  if (transform === 'ircc_country') {
    const iso3 = toIso3(raw);
    return iso3 ? (IRCC_COUNTRY_CODES[iso3] ?? null) : null;
  }
  if (transform === 'strip_dashes') {
    // IRCC: "letters, numbers and spaces with no special characters".
    const v = raw.replace(/[-‐-―]/g, '').trim();
    return /^[A-Za-z0-9 ]+$/.test(v) ? v : null;
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
  if (transform === 'digits') {
    const v = raw.replace(/\D/g, '');
    return v === '' ? null : v;
  }
  const m = ISO_DATE.exec(raw.trim());
  if (!m) return null;
  if (transform === 'date_year') return m[1];
  if (transform === 'date_month') return m[2];
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
    if (v != null) return v;
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
