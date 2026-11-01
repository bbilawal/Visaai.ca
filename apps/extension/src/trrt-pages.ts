/**
 * The IRCC Portal (tr-rt: visitor visa, business visitor, super visa) form
 * pages where auto-advance may press "Save and continue" (#next_path) for the
 * applicant. An ALLOW-list, copied from the visitor mapping's page list
 * (apps/api/src/modules/automation/portal-fills/canada-ircc.ts IRCC_PAGES,
 * plus the business visitor's /special-event-code), WITHOUT /doc-upload.
 *
 * Every other tr-rt page is refused: /summary and everything after it
 * (documents, fees, consent, signature, submission, payment), /error, the
 * landing page and any page not listed here. Read-only data; no DOM access.
 */
export const TRRT_HOST = 'tr-rt.apps.cic.gc.ca'

export const AUTO_ADVANCE_PAGES: readonly string[] = Object.freeze([
  '/group-questions',
  '/purpose',
  '/special-event-code',
  '/representative',
  '/bio-data',
  '/bio-data-travel-docs',
  '/nationality',
  '/national-id-doc',
  '/other-names',
  '/contact-info',
  '/minors-guardian',
  '/biometrics',
  '/inviter-info',
  '/finances',
  '/activities',
  '/travel-history',
  '/validity-status',
  '/crime-activity',
  '/security-questions',
  '/medical-background-questions',
  '/medical-tuberculosis',
  '/medical-questions',
  '/family-info',
  '/family-info-children',
  '/family-info-parents',
  '/language',
  '/contact-info-email',
  '/contact-info-tel',
])

/** Is this URL PATH one of the allow-listed tr-rt form pages? Exact, trailing slash tolerated. */
export function isAutoAdvancePath(path: string | null | undefined): boolean {
  if (typeof path !== 'string') return false
  const p = path.replace(/\/+$/, '') || '/'
  return AUTO_ADVANCE_PAGES.includes(p.toLowerCase())
}

/** A tr-rt URL on an allow-listed form page. */
export function isAutoAdvanceUrl(url: string | null | undefined): boolean {
  try {
    const u = new URL(url ?? '')
    return u.protocol === 'https:' && u.hostname.toLowerCase() === TRRT_HOST && isAutoAdvancePath(u.pathname)
  } catch {
    return false
  }
}

/** The tr-rt summary page (or anything under it): the applicant's review, never pressed past. */
export function isTrrtSummaryUrl(url: string | null | undefined): boolean {
  try {
    const u = new URL(url ?? '')
    return u.hostname.toLowerCase() === TRRT_HOST && /^\/summary(\/|$|-)/i.test(u.pathname)
  } catch {
    return false
  }
}

/**
 * IRCC's "You selected: …" page between /purpose and the form
 * (/application-type/tourist, live 2026-10-31): it only explains the choice
 * and its one button is "Continue to application". Auto-advance never presses
 * it, but passing it is expected, so it does not turn auto-advance off.
 */
export function isTrrtInfoUrl(url: string | null | undefined): boolean {
  try {
    const u = new URL(url ?? '')
    return (
      u.protocol === 'https:' &&
      u.hostname.toLowerCase() === TRRT_HOST &&
      /^\/application-type\/[a-z0-9-]+\/?$/i.test(u.pathname)
    )
  } catch {
    return false
  }
}
