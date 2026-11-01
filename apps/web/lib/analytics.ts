/**
 * Thin, vendor-agnostic client analytics. No SDK is installed; this fans events
 * out to whatever sink is available and is a safe no-op otherwise:
 *   1. window.dataLayer  (GTM / GA4 friendly) — always pushed if present
 *   2. NEXT_PUBLIC_ANALYTICS_URL via sendBeacon (server-side collector), if set
 *   3. console.debug in development
 *
 * Never throws — analytics must not break the funnel. Swap the body for a real
 * provider later without touching call sites.
 */

export type AnalyticsEvent =
  | 'intake_started'
  | 'question_answered'
  | 'required_documents_generated'
  | 'upload_cta_clicked'
  // Distinct from `upload_cta_clicked` on purpose: both land on the documents
  // page, but one is the applicant naming their route and being taken there,
  // and the other is them abandoning the interview. Collapsing them would hide
  // which of the two the funnel is actually made of.
  | 'visa_type_chosen'
  | 'auth_modal_opened'
  | 'signup_completed'
  | 'login_completed'
  | 'documents_unlocked'

type Props = Record<string, unknown>

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>
  }
}

export function track(event: AnalyticsEvent, props: Props = {}): void {
  if (typeof window === 'undefined') return
  const payload = { event, ts: Date.now(), ...props }
  try {
    window.dataLayer = window.dataLayer ?? []
    window.dataLayer.push(payload)

    const url = process.env.NEXT_PUBLIC_ANALYTICS_URL
    if (url && typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
      navigator.sendBeacon(url, new Blob([JSON.stringify(payload)], { type: 'application/json' }))
    }

    if (process.env.NODE_ENV !== 'production') {
      console.debug('[analytics]', event, props)
    }
  } catch {
    // analytics is best-effort; never disrupt the user flow
  }
}
