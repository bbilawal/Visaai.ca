/**
 * Cross-panel signal on the consultant review screen: "a value under the
 * pre-submission review changed on the server".
 *
 * The Fields table, the Documents & forms panel and the pre-submission review
 * are separate client components. A correction in either of the first two is
 * saved through the same endpoint as the review's own Edit and RESETS the
 * covering check server-side — but router.refresh() does not touch a client
 * component's state, so the review panel kept showing the check ticked and
 * "Complete & lock" disabled with no reason (dry run 2026-10-14, #31).
 */
export const PREFLIGHT_CHANGED_EVENT = 'visaai:preflight-changed'

export interface PreflightChangedDetail {
  applicationId: string
}

export function notifyPreflightChanged(applicationId: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<PreflightChangedDetail>(PREFLIGHT_CHANGED_EVENT, { detail: { applicationId } }),
  )
}

/** Subscribe to changes for one application. Returns the unsubscribe. */
export function onPreflightChanged(applicationId: string, fn: () => void): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<PreflightChangedDetail>).detail
    if (detail?.applicationId === applicationId) fn()
  }
  window.addEventListener(PREFLIGHT_CHANGED_EVENT, handler)
  return () => window.removeEventListener(PREFLIGHT_CHANGED_EVENT, handler)
}

/**
 * "The pre-submission review's lock changed" (locked, or retired by a new
 * review). Separate from PREFLIGHT_CHANGED_EVENT because the review panel
 * emits it and must not re-read itself in response (that would overwrite the
 * review it just started). The decision controls listen: Approve needs a lock.
 */
export const PREFLIGHT_LOCK_CHANGED_EVENT = 'visaai:preflight-lock-changed'

export function notifyPreflightLockChanged(applicationId: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<PreflightChangedDetail>(PREFLIGHT_LOCK_CHANGED_EVENT, { detail: { applicationId } }),
  )
}

export function onPreflightLockChanged(applicationId: string, fn: () => void): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<PreflightChangedDetail>).detail
    if (detail?.applicationId === applicationId) fn()
  }
  window.addEventListener(PREFLIGHT_LOCK_CHANGED_EVENT, handler)
  return () => window.removeEventListener(PREFLIGHT_LOCK_CHANGED_EVENT, handler)
}

/**
 * "A consultant decided an uploaded document or generated item." The decision
 * controls listen: a refused approval names an open document request, and once
 * the consultant decides documents that refusal no longer describes the state
 * (live 2026-10-20 — it stayed on screen and read as current).
 */
export const REVIEW_ITEM_DECIDED_EVENT = 'visaai:review-item-decided'

export function notifyReviewItemDecided(applicationId: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<PreflightChangedDetail>(REVIEW_ITEM_DECIDED_EVENT, { detail: { applicationId } }),
  )
}

export function onReviewItemDecided(applicationId: string, fn: () => void): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<PreflightChangedDetail>).detail
    if (detail?.applicationId === applicationId) fn()
  }
  window.addEventListener(REVIEW_ITEM_DECIDED_EVENT, handler)
  return () => window.removeEventListener(REVIEW_ITEM_DECIDED_EVENT, handler)
}
