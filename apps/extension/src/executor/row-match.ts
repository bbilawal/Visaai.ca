/**
 * Whether a reviewed row summary ("Pakistan — Citizen since 1961-06-15") is
 * already one of the page's rows: every word of the summary is a whole word
 * of the row, as many times as the summary has it. Word order is not checked
 * (IRCC's columns differ from the summary's order). Pure; used by the content
 * script to avoid adding the same row twice.
 *
 * Lives outside content.ts on purpose: a content script is loaded as a classic
 * script, and an `export` in its bundle is a syntax error that stops it from
 * loading at all (0.1.12, dry run 2026-10-16).
 */
// "now" ends an open-ended summary ("Max Care 2025-08 to now", a job, school
// or residence still going): IRCC leaves that row's To column blank, so the
// word is never in the row (live 2026-10-31, /activities).
const ROW_FILLER = new Set(['since', 'born', 'the', 'and', 'of', 'to', 'at', 'now'])

export function rowSummaryPresent(summary: string, rows: string[]): boolean {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9\-]+/g, ' ')
  const words = norm(summary)
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !ROW_FILLER.has(w) && w !== '-')
  if (words.length < 2) return false
  // A word the summary repeats must appear as often in the row: a trip that
  // starts and ends in the same month ("Thailand 2022-05 to 2022-05") is not
  // a row from 2022-04 to 2022-05, which carries 2022-05 only once.
  const need = new Map<string, number>()
  for (const w of words) need.set(w, (need.get(w) ?? 0) + 1)
  return rows.some((r) => {
    const have = new Map<string, number>()
    for (const w of norm(r).split(/\s+/)) have.set(w, (have.get(w) ?? 0) + 1)
    return [...need].every(([w, n]) => (have.get(w) ?? 0) >= n)
  })
}
