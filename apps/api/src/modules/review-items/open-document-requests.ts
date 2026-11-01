import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Which consultant requests on uploaded documents are still OPEN.
 *
 * A consultant's needs_reupload / rejected decision is about ONE document
 * (application_item_reviews.item_id = documents.id). It stays open until
 *   - the consultant decides again on that document (latest row wins), or
 *   - the applicant uploads a REPLACEMENT: a document in the same checklist
 *     slot created after the decision. A file already in the slot when the
 *     consultant decided is not a replacement — a multi-file slot (bank
 *     statements A then B, consultant asks to re-upload A) stays open.
 * A document with no slot (the catch-all "Other documents") has nothing that
 * can replace it, so only a newer decision (or a later upload, if it was
 * deleted — below) closes it.
 *
 * A requested document the applicant DELETED is gone from `documents` (hard
 * delete), and with it its slot, so a replacement cannot be matched to a
 * slot. Its request stays open until ANY document is uploaded to the
 * application after the decision: deleting the file must not clear the
 * request (and with it the approval blocker) on its own. The consultant can
 * also close it: ReviewItemsService lists the deleted document and accepts an
 * approval on it. (Matching the replacement by document type is not possible:
 * the decision row does not record the deleted document's type.)
 *
 * Pure, shared by the applicant's vault read (DocumentsService.getDocuments),
 * the server's documents-completion checks (openRequestSlots) and the
 * application-approval blocker (ReviewItemsService).
 */

export type DocumentRequestDecision = 'needs_reupload' | 'rejected';

export interface RequestDocument {
  id: string;
  checklist_item_id?: string | null;
  created_at: string | null;
}

export interface RequestDecisionRow {
  item_kind: string;
  item_id: string;
  decision: string;
  note: string | null;
  created_at: string;
}

const REQUESTS = new Set<string>(['needs_reupload', 'rejected']);

export function isRequestDecision(decision: string): boolean {
  return REQUESTS.has(decision);
}

function ts(s: string | null | undefined): number {
  const n = Date.parse(String(s ?? ''));
  return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
}

/** Latest document-kind decision per document id. */
export function latestDocumentDecisions<T extends RequestDecisionRow>(
  rows: T[],
): Map<string, T> {
  const latest = new Map<string, T>();
  for (const r of rows) {
    if (r.item_kind !== 'document') continue;
    const prev = latest.get(r.item_id);
    if (!prev || ts(r.created_at) >= ts(prev.created_at))
      latest.set(r.item_id, r);
  }
  return latest;
}

/**
 * True when a replacement for `doc` exists: another document in the same
 * checklist slot created after both `doc` and the decision (`decidedAt`).
 */
export function isSuperseded(
  doc: RequestDocument,
  docs: RequestDocument[],
  decidedAt: string,
): boolean {
  if (!doc.checklist_item_id) return false;
  const after = Math.max(ts(doc.created_at), ts(decidedAt));
  return docs.some(
    (d) =>
      d.id !== doc.id &&
      d.checklist_item_id === doc.checklist_item_id &&
      ts(d.created_at) > after,
  );
}

/**
 * Open requests, keyed by document id: the latest decision is needs_reupload
 * or rejected and no replacement has been uploaded. `doc` is null for a
 * requested document that has since been deleted (see above).
 */
export function openDocumentRequests<
  D extends RequestDocument,
  R extends RequestDecisionRow,
>(docs: D[], decisions: R[]): Map<string, { doc: D | null; decision: R }> {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const open = new Map<string, { doc: D | null; decision: R }>();
  for (const [id, d] of latestDocumentDecisions(decisions)) {
    if (!isRequestDecision(d.decision)) continue;
    const doc = byId.get(id) ?? null;
    if (doc) {
      if (isSuperseded(doc, docs, d.created_at)) continue;
    } else if (docs.some((x) => ts(x.created_at) > ts(d.created_at))) {
      continue; // deleted, and something was uploaded after the request
    }
    open.set(id, { doc, decision: d });
  }
  return open;
}

/**
 * Checklist slot ids holding a document with an open request — the server's
 * side of the vault rule (apps/web/lib/consultant-requests.ts): such a slot
 * is not satisfied, whatever its stored status says. Reads with the client it
 * is given (user-scoped under RLS, or service-role in background paths).
 * Throws on a read error; callers decide how to degrade.
 */
export async function openRequestSlots(
  db: SupabaseClient,
  applicationId: string,
): Promise<Set<string>> {
  const [d, r] = await Promise.all([
    db
      .from('documents')
      .select('id, checklist_item_id, created_at')
      .eq('application_id', applicationId),
    db
      .from('application_item_reviews')
      .select('item_kind, item_id, decision, note, created_at')
      .eq('application_id', applicationId)
      .eq('item_kind', 'document'),
  ]);
  if (d.error) throw new Error(`documents read failed: ${d.error.message}`);
  if (r.error) throw new Error(`reviews read failed: ${r.error.message}`);
  const slots = new Set<string>();
  for (const { doc } of openDocumentRequests(
    (d.data ?? []) as RequestDocument[],
    (r.data ?? []) as RequestDecisionRow[],
  ).values()) {
    if (doc?.checklist_item_id) slots.add(doc.checklist_item_id);
  }
  return slots;
}

/**
 * The checklist as completion should count it: a slot with an open request
 * reads 'missing' (a waived slot stays waived). Same rule as the vault's
 * withConsultantRequests.
 */
export function withOpenRequestSlots<
  T extends { id?: string | null; status: string },
>(items: T[], slots: Set<string>): T[] {
  if (slots.size === 0) return items;
  return items.map((i) =>
    i.id && slots.has(i.id) && i.status !== 'waived' && i.status !== 'missing'
      ? { ...i, status: 'missing' }
      : i,
  );
}
