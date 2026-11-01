/**
 * Planned stay, read from the DATES the applicant gave — never from a stored
 * day count.
 *
 * A stored `duration_of_stay_days` goes stale the moment the applicant corrects
 * a date: the dry run of 2026-10-14 had a profile saying 56 days next to dates
 * that spanned 61. Everything that shows or writes a stay length (prefill, the
 * portal mapping, the readiness rules) derives it here, so they cannot drift
 * apart.
 *
 * Pure and dependency-free: shared by the API and the web app.
 */

/** Profile keys that hold the planned date of ENTRY into the destination, most canonical first. */
export const ENTRY_DATE_KEYS = [
  'planned_entry_date',
  'intended_arrival_date',
  'intended_entry_date',
  'planned_arrival_date',
  'expected_arrival_date',
  'arrival_date',
  'entry_date',
  'date_of_arrival',
  'travel_start_date',
] as const

/** Profile keys that hold the planned date of LEAVING the destination, most canonical first. */
export const DEPARTURE_DATE_KEYS = [
  'planned_departure_date',
  'intended_departure_date',
  'planned_exit_date',
  'expected_departure_date',
  'departure_date',
  'exit_date',
  'return_date',
  'planned_return_date',
  'date_of_departure',
  'travel_end_date',
] as const

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000

/** Milliseconds (UTC midnight) of an ISO `YYYY-MM-DD` date, or null when it is not one. */
export function isoDayMs(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const m = ISO_DAY.exec(v.trim())
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const d = new Date(t)
  // Reject roll-overs such as 2027-02-30.
  if (d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null
  return t
}

/**
 * Days in the stay, counting both the arrival and the departure day — IRCC's
 * reading: 1 March → 30 April is 61 days. Null when either date is unreadable
 * or the departure is before the arrival.
 */
export function stayDaysInclusive(entry: unknown, departure: unknown): number | null {
  const a = isoDayMs(entry)
  const b = isoDayMs(departure)
  if (a === null || b === null || b < a) return null
  return Math.round((b - a) / DAY_MS) + 1
}

function firstIsoDate(profile: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = profile[k]
    if (isoDayMs(v) !== null) return String(v).trim()
  }
  return null
}

export interface PlannedStay {
  entryDate: string | null
  departureDate: string | null
  /** Inclusive day count derived from the two dates; null unless both are readable. */
  days: number | null
}

/** The planned stay a profile describes, from whichever date keys it used. */
export function plannedStay(profile: Record<string, unknown> | null | undefined): PlannedStay {
  const p = profile ?? {}
  const entryDate = firstIsoDate(p, ENTRY_DATE_KEYS)
  const departureDate = firstIsoDate(p, DEPARTURE_DATE_KEYS)
  return {
    entryDate,
    departureDate,
    days: stayDaysInclusive(entryDate, departureDate),
  }
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** "2027-03-01" → "March 1, 2027". Returns the input unchanged when it is not an ISO date. */
export function formatLongDate(iso: string): string {
  const t = isoDayMs(iso)
  if (t === null) return iso
  const d = new Date(t)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

/** Up to this many days a stay reads naturally as a day count; beyond it, in months. */
const DAY_COUNT_LIMIT = 183

function addMonthsUtc(t: number, months: number): number {
  const d = new Date(t)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + months
  const day = d.getUTCDate()
  // Clamp to the last day of the target month (Jan 31 + 1 month = Feb 28/29).
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return Date.UTC(y, m, Math.min(day, last))
}

/**
 * The length of a stay as a letter or form should say it.
 *
 * A short visit is a day count ("61 days", inclusive — the IRCC reading). A
 * long one is not: a super visa parent staying from 1 March 2027 to
 * 28 February 2028 is staying "12 months", and a letter that says "a visit
 * of 365 days" reads like a tourist trip that forgot to end. Within three days
 * of a whole number of months the months are stated plainly; otherwise they
 * are "about N months".
 *
 * Null unless both dates are readable and in order.
 */
export function stayLengthPhrase(entry: unknown, departure: unknown): string | null {
  const days = stayDaysInclusive(entry, departure)
  if (days === null) return null
  if (days <= DAY_COUNT_LIMIT) return `${days} day${days === 1 ? '' : 's'}`
  const start = isoDayMs(entry)!
  // The stay ends at the close of the departure day.
  const end = isoDayMs(departure)! + DAY_MS
  let whole = 0
  while (addMonthsUtc(start, whole + 1) <= end) whole++
  const floor = addMonthsUtc(start, whole)
  const ceil = addMonthsUtc(start, whole + 1)
  const toFloor = Math.round((end - floor) / DAY_MS)
  const toCeil = Math.round((ceil - end) / DAY_MS)
  const months = toCeil < toFloor ? whole + 1 : whole
  const off = Math.min(toFloor, toCeil)
  const unit = months === 1 ? 'month' : 'months'
  return off <= 3 ? `${months} ${unit}` : `about ${months} ${unit}`
}
