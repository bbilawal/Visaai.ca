import type { VriInputData } from '../vri.state';

/**
 * Evidence readers shared by the VRI factor scorers.
 *
 * WHY THIS EXISTS. The intake extractor writes `application_profiles.profile_json`
 * with model-chosen snake_case keys (see intake process-answer EXTRACT_PROMPT),
 * so the same fact arrives as `has_property` on one application and
 * `family_home_owned` on the next. The original scorers read a handful of
 * hard-coded keys, found none of them on real applications, and returned
 * their floor constants — e.g. home ties 0% for an applicant who owns two
 * properties and whose wife lives at home. That is a dummy score.
 *
 * These helpers resolve each fact from a set of key PATTERNS and, separately,
 * read the content that OCR actually extracted from each uploaded document
 * (document_verifications.details_json.extracted_fields), keyed by document.
 * A document whose OCR failed contributes NOTHING — it is reported as
 * unreadable, never counted as evidence.
 */

export type Profile = Record<string, unknown>;

const TRUE_STRINGS = new Set(['true', 'yes', 'y', '1']);
const FALSE_STRINGS = new Set(['false', 'no', 'n', '0', 'none']);

export function asBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (TRUE_STRINGS.has(s)) return true;
    if (FALSE_STRINGS.has(s)) return false;
  }
  return undefined;
}

/** Display form of an extracted value (never "[object Object]"). */
export function str(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return v === undefined || v === null ? '' : JSON.stringify(v);
}

export function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[,\s]/g, '').replace(/[^0-9.-]/g, ''));
    if (v.trim() && Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Profile entries whose key matches any pattern (and none of `exclude`). */
function entries(p: Profile, patterns: RegExp[], exclude: RegExp[] = []) {
  return Object.entries(p ?? {}).filter(
    ([k]) =>
      patterns.some((re) => re.test(k)) && !exclude.some((re) => re.test(k)),
  );
}

/** First boolean-valued answer whose key matches. `undefined` = never asked. */
export function boolFact(
  p: Profile,
  patterns: RegExp[],
  exclude: RegExp[] = [],
): boolean | undefined {
  for (const [, v] of entries(p, patterns, exclude)) {
    const b = asBool(v);
    if (b !== undefined) return b;
  }
  return undefined;
}

export function numFacts(
  p: Profile,
  patterns: RegExp[],
  exclude: RegExp[] = [],
): Array<{ key: string; value: number }> {
  const out: Array<{ key: string; value: number }> = [];
  for (const [k, v] of entries(p, patterns, exclude)) {
    const n = asNumber(v);
    if (n !== undefined && n > 0) out.push({ key: k, value: n });
  }
  return out;
}

export function strFact(
  p: Profile,
  patterns: RegExp[],
  exclude: RegExp[] = [],
): string | undefined {
  for (const [, v] of entries(p, patterns, exclude)) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

/** Currency from a key suffix (`_cad`, `_usd`, ...) or an explicit field. */
export function currencyOfKey(key: string, p?: Profile): string | undefined {
  const m = key.match(
    /_(usd|cad|eur|gbp|aud|nzd|pkr|inr|aed|sar|cny|jpy|php|ngn|bdt)$/i,
  );
  if (m) return m[1].toUpperCase();
  const declared = p && strFact(p, [/^(funds_)?currency$/, /funds_currency/]);
  return declared?.toUpperCase();
}

/**
 * APPROXIMATE units-per-USD, used ONLY to band funds against stay length
 * (is this roughly enough?), never shown to the user as a conversion. An
 * unknown currency is not guessed: the adequacy check is skipped instead.
 */
const UNITS_PER_USD: Record<string, number> = {
  USD: 1,
  CAD: 1.37,
  EUR: 0.92,
  GBP: 0.79,
  AUD: 1.52,
  NZD: 1.66,
  AED: 3.67,
  SAR: 3.75,
  INR: 84,
  PKR: 280,
  BDT: 120,
  PHP: 57,
  NGN: 1550,
  CNY: 7.2,
  JPY: 150,
};

export function toUsd(
  amount: number,
  currency: string | undefined,
): number | undefined {
  if (!currency) return undefined;
  const rate = UNITS_PER_USD[currency.toUpperCase()];
  return rate ? amount / rate : undefined;
}

// ---------------------------------------------------------------------------
// Stay length
// ---------------------------------------------------------------------------

export function parseDate(v: unknown): Date | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return utc(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/); // DD.MM.YYYY
  if (m) return utc(+m[3], +m[2], +m[1]);
  return undefined;
}

function utc(y: number, mo: number, d: number): Date | undefined {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 ? dt : undefined;
}

const STATED_STAY = [
  /duration_of_stay/,
  /length_of_stay/,
  /stay_(length|duration)/,
  /^trip_duration/,
];

export function stayFacts(p: Profile): {
  statedDays?: number;
  /** A stay stated in months (`planned_stay_duration_months`), never read as days. */
  statedMonths?: number;
  datedDays?: number;
  days?: number;
} {
  const statedDays = numFacts(p, STATED_STAY, [/_(months?|weeks?|years?)$/])[0]
    ?.value;
  const statedMonths = numFacts(p, STATED_STAY, [/insurance/]).find((x) =>
    /_months?$/.test(x.key),
  )?.value;
  const entry = parseDate(
    strFact(
      p,
      [/(entry|arrival|start)_date/],
      [/visa|biometric|refusal|employment|program/],
    ),
  );
  const exit = parseDate(
    strFact(
      p,
      [/(departure|exit|end|return)_date/],
      [/visa|biometric|refusal|employment|program/],
    ),
  );
  const datedDays =
    entry && exit && exit > entry
      ? Math.round((exit.getTime() - entry.getTime()) / 86_400_000)
      : undefined;
  return {
    statedDays,
    statedMonths,
    datedDays,
    days:
      datedDays ??
      statedDays ??
      (statedMonths ? Math.round(statedMonths * 30.44) : undefined),
  };
}

// ---------------------------------------------------------------------------
// Prior refusals
// ---------------------------------------------------------------------------

export interface RefusalFacts {
  /** undefined = the applicant was never asked */
  priorRefusal?: boolean;
  reason?: string;
  date?: Date;
  /** Refusal grounds recognised in the reason text. */
  grounds: Array<
    'home_ties' | 'purpose' | 'funds' | 'travel_history' | 'misrepresentation'
  >;
  otherRefusal?: boolean;
  violations: boolean;
}

export function refusalFacts(p: Profile): RefusalFacts {
  const priorRefusal = boolFact(
    p,
    [
      /^has_prior_refusal$/,
      /(previous|prior|past)_.*refus/,
      /^visa_refused/,
      /refused_(visa|before)/,
    ],
    [/reason|date|number|other_/],
  );
  const otherRefusal = boolFact(p, [/^other_.*refus/]);
  const reason = strFact(p, [/refus.*reason/, /reason.*refus/]);
  const date = parseDate(strFact(p, [/refus.*date/]));
  const violations =
    boolFact(p, [
      /immigration_violation/,
      /removal_order/,
      /deport/,
      /overstay/,
    ]) === true;

  const r = (reason ?? '').toLowerCase();
  const grounds: RefusalFacts['grounds'] = [];
  if (/179\s*\(b\)|ties|leave .*at the end|return/.test(r))
    grounds.push('home_ties');
  if (/purpose|temporary|postpartum|childcare|work/.test(r))
    grounds.push('purpose');
  if (/fund|financ|179\s*\(c\)|means/.test(r)) grounds.push('funds');
  if (/travel history/.test(r)) grounds.push('travel_history');
  if (/misrepresent|40\(1\)/.test(r)) grounds.push('misrepresentation');

  return {
    priorRefusal: priorRefusal ?? (reason ? true : undefined),
    reason,
    date,
    grounds,
    otherRefusal,
    violations,
  };
}

// ---------------------------------------------------------------------------
// Uploaded documents and what OCR actually read from them
// ---------------------------------------------------------------------------

export interface DocEvidence {
  id: string;
  type: string;
  /**
   * OCR read the document: it produced extracted fields, or text (a letter of
   * invitation or an income summary can be read in full and still yield no
   * identity field — prod 2026-10-16, app 61f16bb5, 4,305 characters read and
   * reported as "could not be read").
   */
  readable: boolean;
  /** OCR ran and failed (rate limit, unreadable scan...). */
  failed: boolean;
  fields: Record<string, unknown>;
}

export function documentEvidence(data: VriInputData): DocEvidence[] {
  const fieldsByDoc = new Map<string, Record<string, unknown>>();
  const textRead = new Set<string>();
  for (const v of data.verifications ?? []) {
    if (!v.document_id) continue;
    const details: Record<string, unknown> = v.details_json ?? {};
    const ocrLength = asNumber(details.raw_ocr_length);
    if (ocrLength !== undefined && ocrLength > 0 && !details.error)
      textRead.add(v.document_id);
    const f = (details.extracted_fields ?? {}) as Record<string, unknown>;
    if (f && typeof f === 'object' && Object.keys(f).length > 0) {
      fieldsByDoc.set(v.document_id, {
        ...(fieldsByDoc.get(v.document_id) ?? {}),
        ...f,
      });
    }
  }
  return (data.documents ?? []).map((d) => {
    const fields = fieldsByDoc.get(d.id) ?? {};
    const readable =
      d.ocr_status === 'complete' &&
      (Object.keys(fields).length > 0 || textRead.has(d.id));
    return {
      id: d.id,
      type: (d.document_type ?? 'document').toLowerCase(),
      readable,
      failed:
        d.ocr_status === 'failed' || (d.ocr_status === 'complete' && !readable),
      fields,
    };
  });
}

export function docsOfType(
  docs: DocEvidence[],
  ...types: RegExp[]
): DocEvidence[] {
  return docs.filter((d) => types.some((re) => re.test(d.type)));
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export function nameTokens(name: unknown): Set<string> {
  if (typeof name !== 'string') return new Set();
  return new Set(
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

export type NameRelation = 'same' | 'overlap' | 'different' | 'unknown';

/** Order-insensitive name comparison ("AHMAD MUZAFFAR" == "Muzaffar Ahmad"). */
export function compareNames(a: unknown, b: unknown): NameRelation {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.size === 0 || tb.size === 0) return 'unknown';
  const shared = [...ta].filter((t) => tb.has(t)).length;
  if (shared === 0) return 'different';
  if (shared === ta.size && shared === tb.size) return 'same';
  return 'overlap';
}

export function applicantName(p: Profile): string | undefined {
  return strFact(p, [
    /^full_name$/,
    /^applicant_name$/,
    /^applicant_full_name$/,
    /^name$/,
  ]);
}

/** Whether a document is about the applicant (vs a sponsor / relative). */
export function isAboutApplicant(
  doc: DocEvidence,
  p: Profile,
): boolean | undefined {
  const holder =
    doc.fields.full_name ??
    doc.fields.account_holder_name ??
    doc.fields.employee_name;
  const name = applicantName(p);
  const rel = compareNames(holder, name);
  if (rel === 'unknown') return undefined;
  if (rel !== 'overlap') return rel === 'same';
  // Partial overlap: one shared family name ("Bilal Tariq" vs "Tariq Mahmood")
  // is a RELATIVE, not the applicant. Only count it when one name contains the
  // other entirely (middle names, honorifics).
  const th = nameTokens(holder);
  const ta = nameTokens(name);
  return [...ta].every((t) => th.has(t)) || [...th].every((t) => ta.has(t));
}
