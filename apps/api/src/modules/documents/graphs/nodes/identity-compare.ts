/**
 * Pure comparison rules for the applicant identity cross-check
 * (run_cross_verification). Kept free of I/O so every rule is unit-tested.
 *
 * Dry run 2026-10-14 (Canada TRV, prod) produced three false alarms that this
 * module exists to prevent:
 *   - "1961-06-15" ≠ "15.06.1961"            — the same date, compared as text
 *   - "1961-06-15" ≠ "June 2025,"            — a letter date read as a DOB
 *   - "MUZAFFAR AHMAD" ≠ "Sumera Ahmad Muzaffar Ahmad" — a two-person ID scan
 * and compared the applicant's passport against a son's bank statement and
 * employment letter, which are legitimately in another person's name.
 */

import { isPhotoDocumentType } from '../../ocr/extraction-schema';

export type IdentityRole = 'identity' | 'generic' | 'supporting';

/**
 * Document types that ARE the applicant's identity (prefix-matched, so
 * `passport_copy`, `national_id_card`, `passport_biographic_page` resolve).
 */
const IDENTITY_PREFIXES = [
  'passport',
  'national_id',
  'id_card',
  'cnic',
  'nic',
  'travel_document',
  'identity_document',
  'residence_permit',
  'permanent_resident_card',
];

/** Untyped uploads: may be an ID scan, may not. Compared tolerantly. */
const GENERIC_TYPES = new Set([
  '',
  'document',
  'other',
  'unknown',
  'additional_document',
]);

/**
 * How a document takes part in the applicant identity cross-check.
 *  - identity:   the applicant's own identity document — the reference.
 *  - generic:    untyped upload; compared only against an identity document.
 *  - supporting: evidence that may legitimately be in someone else's name
 *                (host/sponsor letters, bank statements, insurance, marriage
 *                certificate, prior refusals…). Never cross-checked.
 *                A birth certificate is supporting too: on a visitor or
 *                family application it is almost always a CHILD's, uploaded
 *                to prove the relationship, and comparing it against the
 *                applicant's passport raised a false name/DOB mismatch
 *                (dry run 2026-10-15).
 */
export function identityRole(
  documentType: string | null | undefined,
): IdentityRole {
  const t = (documentType ?? '').toLowerCase().trim();
  if (GENERIC_TYPES.has(t)) return 'generic';
  // `passport_photo` is a photograph, not the passport (prod 2026-10-24).
  if (isPhotoDocumentType(t)) return 'supporting';
  if (IDENTITY_PREFIXES.some((p) => t === p || t.startsWith(`${p}_`))) {
    return 'identity';
  }
  return 'supporting';
}

// ─── Dates ───────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const MAX_AGE_YEARS = 120;

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null; // 31.02.1961
  }
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function month(name: string): number | undefined {
  return MONTHS[name.slice(0, 3).toLowerCase()];
}

/**
 * Every plausible full birth date (YYYY-MM-DD) a raw value can mean.
 *
 * A value with no day, no year, a future date or an age over 120 yields []
 * — it is not a birth date and must not be compared. A bare numeric date whose
 * day/month order is ambiguous (03/04/1990) yields BOTH readings: two dates
 * match when any reading of one equals the other, so an unambiguous passport
 * date settles it without this code guessing which convention was printed.
 */
export function birthDateCandidates(
  raw: unknown,
  now: Date = new Date(),
): string[] {
  if (typeof raw !== 'string') return [];
  const v = raw.trim().replace(/[,.]+$/, '');
  if (!v) return [];

  const out = new Set<string>();
  const add = (y: number, m: number, d: number) => {
    const s = iso(y, m, d);
    if (s) out.add(s);
  };

  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(v))) {
    add(+m[1], +m[2], +m[3]);
  } else if ((m = /^(\d{1,2})[-/.\s](\d{1,2})[-/.\s](\d{4})$/.exec(v))) {
    // D-M-Y and M-D-Y; impossible readings (month 15) drop out in iso().
    add(+m[3], +m[2], +m[1]);
    add(+m[3], +m[1], +m[2]);
  } else if (
    (m = /^(\d{1,2})[-\s.]*([A-Za-z]{3,})\.?[-,\s.]*(\d{4})$/.exec(v))
  ) {
    const mo = month(m[2]);
    if (mo) add(+m[3], mo, +m[1]);
  } else if (
    (m = /^([A-Za-z]{3,})\.?[-\s]+(\d{1,2}),?[-\s]+(\d{4})$/.exec(v))
  ) {
    const mo = month(m[1]);
    if (mo) add(+m[3], mo, +m[2]);
  }

  const today = now.toISOString().slice(0, 10);
  const oldest = `${now.getUTCFullYear() - MAX_AGE_YEARS}${today.slice(4)}`;
  return [...out].filter((d) => d <= today && d >= oldest);
}

// ─── Names ───────────────────────────────────────────────────────────────────

function nameTokens(raw: string): string[] {
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * - match:     same tokens (any order, case, punctuation).
 * - contained: every token of the shorter name (≥2 tokens) appears in the
 *              longer one — a multi-person document or an extra middle name.
 * - mismatch:  otherwise.
 */
export function namesMatch(
  a: string,
  b: string,
): 'match' | 'contained' | 'mismatch' {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length === 0 || tb.length === 0) return 'mismatch';
  const sa = new Set(ta);
  const sb = new Set(tb);
  if (sa.size === sb.size && [...sa].every((t) => sb.has(t))) return 'match';
  const [small, big] = sa.size <= sb.size ? [sa, sb] : [sb, sa];
  if (small.size >= 2 && [...small].every((t) => big.has(t))) {
    return 'contained';
  }
  return 'mismatch';
}

// ─── Field dispatch ──────────────────────────────────────────────────────────

export interface FieldComparison {
  result: 'match' | 'mismatch' | 'warning';
  note?: string;
}

/**
 * Compare one identity field across two documents. Returns null when the pair
 * is not comparable (a value is missing or is not a plausible value for the
 * field) — the caller must then record nothing, not a mismatch.
 */
export function compareIdentityField(
  field: string,
  a: unknown,
  b: unknown,
  now: Date = new Date(),
): FieldComparison | null {
  if (typeof a !== 'string' || typeof b !== 'string') return null;
  if (!a.trim() || !b.trim()) return null;

  switch (field) {
    case 'date_of_birth': {
      const ca = birthDateCandidates(a, now);
      const cb = birthDateCandidates(b, now);
      if (ca.length === 0 || cb.length === 0) return null;
      return ca.some((d) => cb.includes(d))
        ? { result: 'match' }
        : { result: 'mismatch' };
    }
    case 'full_name': {
      const r = namesMatch(a, b);
      if (r === 'match') return { result: 'match' };
      if (r === 'contained') {
        return {
          result: 'warning',
          note: 'One document lists additional names (e.g. it names more than one person); every name on the other document appears in it.',
        };
      }
      return { result: 'mismatch' };
    }
    case 'passport_number': {
      const n = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
      return n(a) === n(b) ? { result: 'match' } : { result: 'mismatch' };
    }
    default: {
      const n = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
      return n(a) === n(b) ? { result: 'match' } : { result: 'mismatch' };
    }
  }
}

// ─── Untyped uploads ────────────────────────────────────────────────────────

export const GENERIC_MISMATCH_NOTE =
  'This upload was not filed as one of your identity documents and may belong to someone else (e.g. a family member). If it is yours, the values should match your passport.';

const DAY_MS = 86_400_000;

/**
 * On an untyped upload a "date of birth" more than a year from the identity
 * document's is not a misread DOB — it is some other date the extractor
 * labelled as one (prod 2026-10-15: an IMM 5621 form's refusal date,
 * 2025-06-30, against a 1961 passport DOB). Nothing useful to compare. A near
 * miss (typo, day/month swap) stays comparable.
 */
export function genericDobIsAnotherDate(
  a: string,
  b: string,
  now: Date = new Date(),
): boolean {
  const ca = birthDateCandidates(a, now);
  const cb = birthDateCandidates(b, now);
  if (ca.length === 0 || cb.length === 0) return false;
  let closest = Infinity;
  for (const x of ca) {
    for (const y of cb) {
      const d = Math.abs(Date.parse(x) - Date.parse(y)) / DAY_MS;
      if (d < closest) closest = d;
    }
  }
  return closest > 366;
}

interface StoredCrossCheck {
  field_compared: string;
  result: string;
  details_json: unknown;
}

/**
 * Re-applies the current untyped-upload rules to a stored cross-check row.
 * Rows are written when a document is processed and are not revisited when the
 * rules change, so a mismatch stored before a rule existed kept showing (prod
 * 2026-10-15). Returns null when the row should no longer be shown.
 */
export function reviewStoredCrossCheck<T extends StoredCrossCheck>(
  row: T,
  now: Date = new Date(),
): T | null {
  const d = (row.details_json ?? {}) as Record<string, unknown>;
  // Only a type the row actually recorded counts; a row without types is
  // left as stored rather than guessed to be an untyped upload.
  const isGeneric = (t: unknown) =>
    typeof t === 'string' && identityRole(t) === 'generic';
  const generic = isGeneric(d.doc_type_a) || isGeneric(d.doc_type_b);
  if (!generic) return row;

  if (
    row.field_compared === 'date_of_birth' &&
    typeof d.value_a === 'string' &&
    typeof d.value_b === 'string' &&
    genericDobIsAnotherDate(d.value_a, d.value_b, now)
  ) {
    return null;
  }
  if (row.result !== 'mismatch') return row;

  const rest = { ...d };
  delete rest.suggestion;
  return {
    ...row,
    result: 'warning',
    details_json: { ...rest, note: GENERIC_MISMATCH_NOTE },
  };
}
