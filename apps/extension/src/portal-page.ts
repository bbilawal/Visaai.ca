/**
 * What kind of portal page a tab is on, and what the applicant should do there.
 *
 * Dry run 2026-10-17: IRCC signs the applicant out after ~20 minutes, sends
 * bookmarked or deep links to an error page, and the account home is not part
 * of the form. A launch bound to one of those pages found nothing to fill and
 * ended, so the applicant had to sign in, reopen the draft AND launch again
 * from VisaAI. The panel now tells them what to do on such a page and keeps
 * the launch: the next form page they open fills as usual.
 *
 * Only pages recognised here are special. Anything else on a portal host is
 * treated as a form page (eTA is one page on its own host) — the server
 * decides what, if anything, it fills.
 */

export type PortalPageKind =
  | 'form'
  | 'signin'
  | 'account'
  | 'error'
  | 'yours'
  | 'review'
  | 'language'
  | 'wrong-portal'

export interface PortalPage {
  kind: PortalPageKind
  /** What to tell the applicant; absent on a form page. */
  message?: string
}

const OPEN_DRAFT =
  'open your application with "Continue" on the draft in your IRCC account. Keep this panel open — the next form page fills automatically.'

const MESSAGES: Record<Exclude<PortalPageKind, 'form' | 'wrong-portal'>, string> = {
  signin: `Sign in to your IRCC account (you do this — the assistant never enters passwords), then ${OPEN_DRAFT}`,
  // IRCC shows its terms and sign-in steps at the same address after a
  // sign-out (live 2026-10-17), so this page may still need a sign-in.
  account: `You are on your IRCC account pages. Accept the terms and sign in if IRCC asks (you do this yourself), then ${OPEN_DRAFT}`,
  error:
    'IRCC showed its error page — usually an expired session or a bookmarked link. Nothing you saved is lost. Go to your IRCC account, sign in if asked, then ' +
    OPEN_DRAFT,
  yours:
    'This page is yours: the assistant never fills fees, the declaration, your signature or payment. Complete it on IRCC yourself.',
  language:
    'Switch the Permanent Residence Portal to English (the "English" link at the top of the page). The assistant fills its English pages only; nothing is written on a French page.',
  review:
    'The questionnaire is done: the assistant stops here. Check every answer on this list (use "Modify my Answers" to correct one), then continue to your document checklist yourself. Uploads, signature and payment are yours.',
}

/** IRCC's own pages for sign-in (portal and the older MyCIC entry). */
function isSignIn(host: string, path: string): boolean {
  if (host === 'portal-portail.apps.cic.gc.ca') return /^\/(signin|sign-in|login|logout)\b/i.test(path)
  if (host === 'onlineservices-servicesenligne.cic.gc.ca') return /\/(mycic\/start|signin|login)\b/i.test(path)
  if (host === 'ircc.canada.ca') return /\/portal\b/i.test(path)
  if (host === PR_HOST) return /^\/(en|fr)\/(login|logout)\b/i.test(path)
  return /(^|\.)clegc-gckey\.gc\.ca$/.test(host)
}

/** Steps of the visitor-visa application after Documents that only the applicant may complete. */
const YOURS = /^\/(fees?|pay|payment|consent|declaration|e-?sign|signature|complete|confirmation|submit)(\/|$|-)/i

/**
 * IRCC's Permanent Residence Portal (spousal sponsorship, live 2026-10-20).
 * Its own accounts sign in at /en/login; "My applications" (/application/
 * dashboard) and "Create a new application" (/application/start) are the
 * applicant's. Every form page carries the application id in its path.
 */
const PR_HOST = 'prson-srpel.apps.cic.gc.ca'
/** PR portal steps only the applicant completes: fees, the declaration (their e-signature), submission. */
const PR_YOURS = /\/(fee|fees|payment|declaration|consent|submit|submission)(\/|$|-)/i

/** The secure account's questionnaire host (study permit, "eapp"). */
const EAPP_HOST = 'onlineservices-servicesenligne.cic.gc.ca'
/**
 * Where the questionnaire ends: review, instructions, checklist, uploads —
 * and previousAnswers, the same answer list "Cancel" returns to after a
 * "Modify my Answers" screen (live 2026-10-24).
 */
const EAPP_AFTER = /^\/eapp\/(comeToCanadaReviewPage|previousAnswers|comeToCanadaInstructions|documentsToSubmit|comeToCanadaResult|comeToCanadaHowToApply)\b/i

/**
 * A server-paged form: every screen loads at the same URL (IRCC's secure
 * account questionnaire, /eapp/eapp — the applicant presses Next and the
 * server sends the next question there). Each page LOAD is a new screen to
 * fill, not the same page again.
 */
export function isServerPagedUrl(url: string | undefined): boolean {
  try {
    const u = new URL(url ?? '')
    return u.hostname.toLowerCase() === EAPP_HOST && /^\/eapp\/eapp\/?$/i.test(u.pathname)
  } catch {
    return false
  }
}

/**
 * A "Modify my Answers" screen of the questionnaire: one question reopened
 * from the answer list, at /eapp/eapp?modifyCaller=…. Its button is "Update
 * information", not Next (live 2026-10-24).
 */
export function isEappEditUrl(url: string | undefined): boolean {
  try {
    return isServerPagedUrl(url) && new URL(url ?? '').searchParams.has('modifyCaller')
  } catch {
    return false
  }
}

/**
 * What identifies a page for the side panel's "fill each page as you reach
 * it": the URL path — and, on the PR portal, the section in `?pageId=`. IMM
 * 5406 and IMM 5669 keep one path for their landing page and every section,
 * so by path alone the panel took Section A for the landing page it had
 * already run on and never filled it (live 2026-10-21). Other query keys (the
 * document and form ids) are not part of the page.
 */
export function followPageKey(url: string | undefined): string | null {
  let u: URL
  try {
    u = new URL(url ?? '')
  } catch {
    return null
  }
  const pageId = u.hostname.toLowerCase() === PR_HOST ? u.searchParams.get('pageId') : null
  return pageId ? `${u.pathname}?pageId=${pageId}` : u.pathname
}

/**
 * The IRCC application flows, each on its own host (or path): tr-rt (visitor
 * visa, business visitor, super visa), the eTA form, the secure account's
 * eligibility questionnaire (study and work permits, /eapp/), and the
 * Permanent Residence Portal (spousal sponsorship). The account sign-in pages
 * (portal-portail, GCKey, MyCIC start) belong to none: every flow passes
 * through them.
 */
type IrccFlow = 'trrt' | 'eta' | 'eapp' | 'pr'

/** The flow each session portal id (the route's, from automation:ready) files on. */
const FLOW_OF_PORTAL: Record<string, IrccFlow> = {
  ircc: 'trrt',
  'ircc-eta': 'eta',
  'ircc-study': 'eapp',
  'ircc-work': 'eapp',
  'ircc-pr-family': 'pr',
}

/** Where to go instead, for a session whose page is on another flow. */
const GO_TO: Record<IrccFlow, string> = {
  trrt: 'This visa is applied for on the IRCC Portal — sign in at portal-portail.apps.cic.gc.ca and start or continue your visitor visa application.',
  eta: 'An eTA is applied for on its own IRCC form — open onlineservices-servicesenligne.cic.gc.ca/eta/welcome and start or continue your eTA application there.',
  eapp: 'This permit is applied for in your IRCC secure account — sign in, choose "Apply to come to Canada" and answer the eligibility questionnaire there.',
  pr: 'This application is made on the IRCC Permanent Residence Portal — sign in at prson-srpel.apps.cic.gc.ca and open your application there.',
}

const WRONG_PAGE =
  ' This tab is on a different IRCC application, so the assistant fills nothing here. Keep this panel open — the right page fills automatically once you open it.'

function flowOfUrl(host: string, path: string): IrccFlow | null {
  if (host === 'tr-rt.apps.cic.gc.ca') return 'trrt'
  if (host === PR_HOST) return 'pr'
  if (host === 'eta.onlineservices-servicesenligne.apps.cic.gc.ca') return 'eta'
  if (host === EAPP_HOST && /^\/eta\//i.test(path)) return 'eta'
  if (host === EAPP_HOST && /^\/eapp\//i.test(path)) return 'eapp'
  return null
}

/**
 * `portalId` is the launched session's portal (automation:ready). A page of
 * ANOTHER IRCC application flow is 'wrong-portal': nothing fills there and
 * that flow's own texts (e.g. the study questionnaire's "The questionnaire is
 * done") never show (live 2026-10-30, a visitor-visa launch on the study
 * permit's review page). Without a known portalId, pages classify as before.
 */
export function classifyPortalPage(url: string | undefined, portalId?: string | null): PortalPage {
  const page = classifyUnscoped(url)
  const expected = portalId ? FLOW_OF_PORTAL[portalId] : undefined
  if (!expected) return page
  let u: URL
  try {
    u = new URL(url ?? '')
  } catch {
    return page
  }
  const flow = flowOfUrl(u.hostname.toLowerCase(), u.pathname)
  if (flow && flow !== expected) return { kind: 'wrong-portal', message: GO_TO[expected] + WRONG_PAGE }
  return page
}

function classifyUnscoped(url: string | undefined): PortalPage {
  let u: URL
  try {
    u = new URL(url ?? '')
  } catch {
    return { kind: 'form' }
  }
  const host = u.hostname.toLowerCase()
  const path = u.pathname
  if (isSignIn(host, path)) return { kind: 'signin', message: MESSAGES.signin }
  if (host === 'portal-portail.apps.cic.gc.ca') return { kind: 'account', message: MESSAGES.account }
  if (host === EAPP_HOST && EAPP_AFTER.test(path)) return { kind: 'review', message: MESSAGES.review }
  if (host === PR_HOST) {
    if (/^\/(en|fr)\/application\/(dashboard|start)\b/i.test(path)) return { kind: 'account', message: MESSAGES.account }
    if (PR_YOURS.test(path)) return { kind: 'yours', message: MESSAGES.yours }
    // Its selects are chosen by English option text (2026-10-20).
    if (/^\/fr\//i.test(path)) return { kind: 'language', message: MESSAGES.language }
  }
  if (host === 'tr-rt.apps.cic.gc.ca') {
    if (/^\/error\b/i.test(path)) return { kind: 'error', message: MESSAGES.error }
    if (path === '/' || /^\/landing-page\b/i.test(path)) return { kind: 'account', message: MESSAGES.account }
    if (YOURS.test(path)) return { kind: 'yours', message: MESSAGES.yours }
  }
  return { kind: 'form' }
}
