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
