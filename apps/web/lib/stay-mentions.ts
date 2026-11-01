/**
 * Checklist notes are written once, by a model, at intake — with the stay
 * length the applicant had then. When the trip dates change the notes keep the
 * old figure (dry run 2026-10-15: "the short 56-day holiday" on a 61-day trip).
 * Rewrite stay-length mentions to the length derived from the current dates,
 * at read time, so existing rows are corrected too.
 *
 * Only "<n>-day <stay word>" / "<n> days in Canada"-style phrases are touched;
 * other day counts ("last 90 days" of statements) are left alone.
 */

const STAY_WORD = '(?:visit|stay|trip|holiday|vacation)'

// "56-day visit", "56 day trip", "62-day family holiday"
const N_DAY_STAY = new RegExp(`\\b(\\d{1,3})([- ]day)(\\s+(?:\\w+\\s+){0,2}${STAY_WORD})\\b`, 'gi')
// "a stay of 62 days", "visit of 56 days"
const STAY_OF_N_DAYS = new RegExp(`\\b(${STAY_WORD}\\s+of\\s+)(\\d{1,3})(\\s+days)\\b`, 'gi')

export function refreshStayMentions(text: string, days: number | null): string {
  if (!days || !text) return text
  return text
    .replace(N_DAY_STAY, (_m, _n, dayPart, rest) => `${days}${dayPart}${rest}`)
    .replace(STAY_OF_N_DAYS, (_m, pre, _n, post) => `${pre}${days}${post}`)
}

type SpecRecord = Record<string, unknown>

/** Returns copies of the checklist items with stay mentions refreshed. */
export function refreshChecklistStay<T extends { added_reason?: string | null; meta?: unknown }>(
  items: T[],
  days: number | null,
): T[] {
  if (!days) return items
  return items.map((item) => {
    const meta = item.meta as { specs?: SpecRecord } | null | undefined
    const specs = meta?.specs
    const nextSpecs = specs
      ? Object.fromEntries(
          Object.entries(specs).map(([k, v]) => [k, typeof v === 'string' ? refreshStayMentions(v, days) : v]),
        )
      : specs
    return {
      ...item,
      added_reason: item.added_reason ? refreshStayMentions(item.added_reason, days) : item.added_reason,
      meta: meta && specs ? { ...meta, specs: nextSpecs } : item.meta,
    }
  })
}
