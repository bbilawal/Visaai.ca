import { rowSummaryPresent } from './row-match'

/**
 * Rows the portal page shows that match none of the rows the consultant
 * reviewed for it. The assistant only ever ADDS rows; a row left from an
 * earlier entry — a child the applicant removed in VisaAI (dry run
 * 2026-10-16: Mian Talha) — stayed on IRCC and nobody was told. The side
 * panel lists them so the applicant can delete them; nothing is deleted
 * automatically, and the row text never leaves the browser.
 *
 * Only data rows count (they carry IRCC's Edit/Delete actions); header rows
 * do not. With no reviewed rows for the page, nothing is reported: the page's
 * tables are not ones the assistant fills.
 */
export function staleRows(pageRows: string[], reviewedSummaries: string[]): string[] {
  if (reviewedSummaries.length === 0) return []
  return pageRows
    .filter((r) => /\bdelete\b/i.test(r))
    .map((r) =>
      r
        .replace(/\b(edit|delete_forever|delete)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((r) => r !== '' && !reviewedSummaries.some((s) => rowSummaryPresent(s, [r])))
}
