/**
 * Length of stay, derived from the planned entry and departure dates.
 *
 * COUNTING CONVENTION — inclusive days: the entry day and the departure day
 * both count, so 2026-12-01 → 2027-01-31 is 62 days (61 nights) and a same-day
 * trip is 1 day. This is the convention the prefilled form already used
 * (prefill finalize-fields, "derive the number of days ... (inclusive)") and
 * the one letters and form now share, so an LOE, a cover letter and the
 * form's duration_of_stay_days can never disagree.
 *
 * Dates win: when both dates are known, any stated duration (the intake's
 * duration_of_stay_days, which the applicant typed as an estimate) is
 * replaced by the date-derived number.
 */

export const ENTRY_KEY =
  /^(planned|intended|expected)?_?(entry|arrival)_date$|^(date_of_)?(entry|arrival)(_date)?$/;
export const DEPARTURE_KEY =
  /^(planned|intended|expected)?_?(departure|exit|return)_date$|^(date_of_)?(departure|exit)(_date)?$/;
export const DURATION_KEY =
  /^(intended_|planned_)?(duration|length)_of_stay(_days|_in_days)?$|^stay_duration(_days)?$/;

const DAY_MS = 86_400_000;

export interface StayFromDates {
  /** YYYY-MM-DD */
  entryDate: string;
  /** YYYY-MM-DD */
  departureDate: string;
  /** Inclusive day count (entry and departure day both count). */
  days: number;
  nights: number;
}

/** Parse a YYYY-MM-DD (optionally followed by a time) to UTC midnight ms. */
export function isoDayMs(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(v.trim());
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return t;
}

function firstDate(
  source: Record<string, unknown>,
  re: RegExp,
): { t: number; raw: string } | null {
  for (const [k, v] of Object.entries(source)) {
    if (!re.test(k)) continue;
    const t = isoDayMs(v);
    if (t !== null) return { t, raw: String(v).trim().slice(0, 10) };
  }
  return null;
}

/** The trip's dates and inclusive length, or null unless both dates parse. */
export function stayFromDates(
  source: Record<string, unknown> | null | undefined,
): StayFromDates | null {
  if (!source || typeof source !== 'object') return null;
  const entry = firstDate(source, ENTRY_KEY);
  const exit = firstDate(source, DEPARTURE_KEY);
  if (!entry || !exit || exit.t < entry.t) return null;
  const nights = Math.round((exit.t - entry.t) / DAY_MS);
  return {
    entryDate: entry.raw,
    departureDate: exit.raw,
    days: nights + 1,
    nights,
  };
}

/**
 * A copy of the profile in which every stated duration equals the
 * date-derived day count (adding duration_of_stay_days if none was stated).
 * Without both dates the profile is returned as-is.
 */
export function withStayFromDates(profile: Record<string, unknown>): {
  profile: Record<string, unknown>;
  stay: StayFromDates | null;
} {
  const stay = stayFromDates(profile);
  if (!stay) return { profile, stay: null };
  const out: Record<string, unknown> = { ...profile };
  let found = false;
  for (const k of Object.keys(out)) {
    if (DURATION_KEY.test(k)) {
      out[k] = stay.days;
      found = true;
    }
  }
  if (!found) out.duration_of_stay_days = stay.days;
  return { profile: out, stay };
}
