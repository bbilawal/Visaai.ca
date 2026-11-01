import type { VriState } from '../vri.state';
import { documentEvidence } from './evidence';

/**
 * Documentation completeness, from what was actually READ — not from what was
 * uploaded.
 *
 * Before: `satisfied / required` where `uploaded` counted as satisfied, so a
 * bank statement that Azure never read (HTTP 429) passed exactly like one that
 * was verified, and every non-checklist upload was ignored.
 *
 * Now, two parts:
 *   - 60%: required checklist items satisfied by a READABLE document. An item
 *     whose only linked uploads failed OCR is NOT satisfied — it is unassessed
 *     content, and is named in the evidence.
 *   - 40%: share of ALL uploaded documents whose content OCR actually read.
 * With no checklist the score is the readable share alone; with neither a
 * checklist nor an upload the factor is unassessed (FAKE-002).
 */
export async function scoreDocumentation(
  state: VriState,
): Promise<Partial<VriState>> {
  const docs = documentEvidence(state.data);
  const required = (state.data.checklistItems ?? []).filter((i) => i.required);
  const notes: string[] = [];

  if (required.length === 0 && docs.length === 0) {
    return {
      scores: { documentation_pct: 0 } as VriState['scores'],
      unassessedFactors: ['documentation_pct'],
      factorEvidence: {
        documentation_pct: [
          'No required checklist items and no uploads to assess.',
        ],
      },
    };
  }

  const baseType = (t: string) => t.toLowerCase().replace(/_copy$|_scan$/, '');
  let satisfied = 0;
  const unsatisfied: string[] = [];
  for (const item of required) {
    const linked = docs.filter(
      (d) =>
        (item.id &&
          (state.data.documents ?? []).find((x) => x.id === d.id)
            ?.checklist_item_id === item.id) ||
        baseType(d.type) === baseType(item.document_type),
    );
    let ok: boolean;
    if (linked.length > 0)
      ok = linked.some((d) => d.readable) || item.status === 'verified';
    else ok = item.status === 'verified';
    if (ok) satisfied++;
    else unsatisfied.push(item.document_type);
  }

  const unreadable = docs.filter((d) => d.failed);
  const readable = docs.filter((d) => d.readable);

  if (required.length > 0)
    notes.push(
      `${satisfied} of ${required.length} required checklist items backed by a verified or readable document` +
        (unsatisfied.length
          ? ` (not satisfied: ${unsatisfied.join(', ')})`
          : '') +
        '.',
    );
  if (docs.length > 0)
    notes.push(
      `${readable.length} of ${docs.length} uploaded documents were read by OCR.`,
    );
  if (unreadable.length > 0)
    notes.push(
      `${unreadable.length} of ${docs.length} uploads could not be read and were NOT assessed: ${unreadable
        .map((d) => d.type)
        .join(', ')}.`,
    );

  const reqPct =
    required.length > 0 ? (satisfied / required.length) * 100 : null;
  const readPct =
    docs.length > 0 ? (readable.length / docs.length) * 100 : null;
  const pct =
    reqPct !== null && readPct !== null
      ? 0.6 * reqPct + 0.4 * readPct
      : (reqPct ?? readPct ?? 0);

  return {
    scores: { documentation_pct: Math.round(pct) } as VriState['scores'],
    factorEvidence: { documentation_pct: notes },
  };
}
