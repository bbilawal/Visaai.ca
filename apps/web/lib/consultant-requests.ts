/**
 * The consultant's review of an uploaded document, as GET /documents/:id
 * returns it on each document (`consultant_review`): the latest decision, its
 * note and date. `open` is computed by the API: a needs_reupload / rejected
 * request that no newer upload into the same slot has answered yet.
 *
 * Live 2026-10-20: a consultant asked for a new passport upload and the vault
 * kept showing the slot as Verified; the request was only in Messages.
 */
export interface ConsultantDocumentReview {
  decision: 'approved' | 'needs_reupload' | 'rejected'
  note: string | null
  decided_at: string
  open: boolean
}

type ReviewedDocument = {
  id: string
  checklist_item_id: string | null
  consultant_review?: ConsultantDocumentReview | null
}

export type ConsultantRequest = ConsultantDocumentReview & {
  decision: 'needs_reupload' | 'rejected'
}

/** The document's consultant decision when it is a re-upload request or a rejection. */
export function requestOf(doc: Pick<ReviewedDocument, 'consultant_review'>): ConsultantRequest | null {
  const r = doc.consultant_review
  if (!r || (r.decision !== 'needs_reupload' && r.decision !== 'rejected')) return null
  return r as ConsultantRequest
}

/** The open request on a slot's documents (the most recent one), or null. */
export function openRequestIn(docs: ReviewedDocument[]): ConsultantRequest | null {
  let found: ConsultantRequest | null = null
  for (const d of docs) {
    const r = requestOf(d)
    if (!r?.open) continue
    if (!found || r.decided_at > found.decided_at) found = r
  }
  return found
}

/**
 * The checklist as the vault shows and counts it: a slot holding a document
 * with an open consultant request is NOT verified (or uploaded) any more — it
 * is back with the applicant, so it reads "missing" for the progress count and
 * the next-upload prompt. A waived slot stays waived. The stored checklist row
 * is not changed; a new upload into the slot closes the request on the server.
 */
export function withConsultantRequests<T extends { id: string; status: string }>(
  checklist: T[],
  documents: ReviewedDocument[],
): T[] {
  const requested = new Set<string>()
  for (const d of documents) {
    if (d.checklist_item_id && requestOf(d)?.open) requested.add(d.checklist_item_id)
  }
  if (requested.size === 0) return checklist
  return checklist.map(item =>
    requested.has(item.id) && item.status !== 'waived' && item.status !== 'missing'
      ? { ...item, status: 'missing' }
      : item,
  )
}
