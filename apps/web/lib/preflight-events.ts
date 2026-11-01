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
