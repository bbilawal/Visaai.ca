/**
 * "Re-read" on a document card: run the current OCR / extraction pipeline
 * again on a file already uploaded. Parser fixes only reach new uploads, so
 * without it a document read before a fix keeps its old (wrong) values.
 */

export type RereadResult = 'queued' | 'already_queued'

export async function requestReread(
  apiUrl: string | undefined,
  token: string,
  documentId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RereadResult> {
  const res = await fetchImpl(`${apiUrl}/documents/item/${documentId}/reprocess`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 429) throw new Error('rate_limited')
  if (!res.ok) throw new Error('failed')
  const body = (await res.json().catch(() => ({}))) as { status?: string }
  return body.status === 'already_queued' ? 'already_queued' : 'queued'
}

/** A document still being read cannot be re-read yet. */
export function canReread(doc: { ocr_status: string }): boolean {
  return doc.ocr_status !== 'pending'
}

/** The message of a checklist item that needs the client's attention, or null. */
export function attentionOf(item: {
  meta?: { needs_attention?: boolean; attention_message?: string | null } | null
}): string | null {
  const meta = item.meta
  if (!meta?.needs_attention) return null
  const msg = meta.attention_message?.trim()
  return msg ? msg : null
}
