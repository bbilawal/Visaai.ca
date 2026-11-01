import { classifyPortalPage, followPageKey } from '../src/portal-page'

/**
 * Dry run 2026-10-17: the applicant gets signed out, lands on IRCC's error
 * page, or is on the account home. The panel must say what to do there and
 * never treat it as a form to fill.
 */
describe('classifyPortalPage', () => {
  it.each([
    ['https://portal-portail.apps.cic.gc.ca/signin?lang=en', 'signin'],
    ['https://onlineservices-servicesenligne.cic.gc.ca/mycic/start', 'signin'],
    ['https://ircc.canada.ca/en/portal', 'signin'],
    ['https://portal-portail.apps.cic.gc.ca/home?lang=en', 'account'],
    ['https://portal-portail.apps.cic.gc.ca/home/application-status/12102619', 'account'],
    ['https://tr-rt.apps.cic.gc.ca/?lang=en', 'account'],
    ['https://tr-rt.apps.cic.gc.ca/landing-page?lang=en', 'account'],
    ['https://tr-rt.apps.cic.gc.ca/error?lang=en', 'error'],
    ['https://tr-rt.apps.cic.gc.ca/fees?appPkgId=1', 'yours'],
    ['https://tr-rt.apps.cic.gc.ca/consent-declaration?appPkgId=1', 'yours'],
    ['https://tr-rt.apps.cic.gc.ca/complete?appPkgId=1', 'yours'],
    ['https://tr-rt.apps.cic.gc.ca/purpose?appPkgId=1', 'form'],
    ['https://tr-rt.apps.cic.gc.ca/doc-upload?appPkgId=1', 'form'],
    ['https://tr-rt.apps.cic.gc.ca/summary?appPkgId=1', 'form'],
    ['https://eta.onlineservices-servicesenligne.apps.cic.gc.ca/eta/apply', 'form'],
    // IRCC Permanent Residence Portal (spousal sponsorship, live 2026-10-20).
    ['https://prson-srpel.apps.cic.gc.ca/en/login', 'signin'],
    ['https://prson-srpel.apps.cic.gc.ca/fr/login', 'signin'],
    ['https://prson-srpel.apps.cic.gc.ca/en/application/dashboard', 'account'],
    ['https://prson-srpel.apps.cic.gc.ca/en/application/start', 'account'],
    ['https://prson-srpel.apps.cic.gc.ca/en/application/case/4989734/declaration', 'yours'],
    ['https://prson-srpel.apps.cic.gc.ca/en/application/profile/4989734', 'form'],
    ['https://prson-srpel.apps.cic.gc.ca/en/application/case/4989734', 'form'],
    ['https://prson-srpel.apps.cic.gc.ca/en/application/case/4989734/imm0008/page3', 'form'],
    ['https://prson-srpel.apps.cic.gc.ca/en/application/case/4989734/imm5669', 'form'],
    // French: every select is chosen by its English text.
    ['https://prson-srpel.apps.cic.gc.ca/fr/application/profile/4989734', 'language'],
    ['https://prson-srpel.apps.cic.gc.ca/fr/application/case/4989734/imm0008/page3', 'language'],
    [undefined, 'form'],
  ])('%s → %s', (url, kind) => {
    const page = classifyPortalPage(url)
    expect(page.kind).toBe(kind)
    expect(Boolean(page.message)).toBe(kind !== 'form')
  })

  it('tells a signed-out applicant to sign in themselves and reopen the draft', () => {
    const m = classifyPortalPage('https://portal-portail.apps.cic.gc.ca/signin').message!
    expect(m).toMatch(/Sign in/)
    expect(m).toMatch(/never enters passwords/)
    expect(m).toMatch(/Continue/)
  })
})

describe('followPageKey: what makes a page "new" for the side panel', () => {
  const PR = 'https://prson-srpel.apps.cic.gc.ca/en/application/case/4992201'
  // Live 2026-10-21: IMM 5406/5669 keep one path for the landing page and every
  // section (only ?pageId= changes), so the panel never filled Section A.
  it('PR portal: the section query is part of the page', () => {
    expect(followPageKey(`${PR}/imm5406`)).toBe('/en/application/case/4992201/imm5406')
    expect(followPageKey(`${PR}/imm5406?pageId=page2&documentId=63203506&formId=abc`)).toBe(
      '/en/application/case/4992201/imm5406?pageId=page2',
    )
    expect(followPageKey(`${PR}/imm5406?pageId=page3&documentId=1`)).not.toBe(
      followPageKey(`${PR}/imm5406?pageId=page2&documentId=1`),
    )
    // Other query keys (ids) do not make a new page.
    expect(followPageKey(`${PR}/imm5669?pageId=page2&documentId=1`)).toBe(
      followPageKey(`${PR}/imm5669?pageId=page2&documentId=2&formId=x`),
    )
    expect(followPageKey(`${PR}/imm0008/page3`)).toBe('/en/application/case/4992201/imm0008/page3')
  })
  it('every other portal: the path alone, as before', () => {
    expect(followPageKey('https://tr-rt.apps.cic.gc.ca/purpose?pageId=2')).toBe('/purpose')
    expect(followPageKey('not a url')).toBeNull()
  })
})

/**
 * Live 2026-10-30 (0.1.55): a visitor-visa launch with the IRCC tab on the
 * study permit's secure-account questionnaire review page showed the study
 * text "The questionnaire is done". A page of ANOTHER IRCC application flow
 * than the session's portal is a wrong-portal page: fill nothing, say where
 * this visa is applied for.
 */
describe('classifyPortalPage scoped to the session portal', () => {
  const EAPP_REVIEW = 'https://onlineservices-servicesenligne.cic.gc.ca/eapp/comeToCanadaReviewPage'
  const EAPP_FORM = 'https://onlineservices-servicesenligne.cic.gc.ca/eapp/eapp'
  const TRRT = 'https://tr-rt.apps.cic.gc.ca/purpose?appPkgId=1'
  const ETA = 'https://eta.onlineservices-servicesenligne.apps.cic.gc.ca/eta/apply'
  const PR = 'https://prson-srpel.apps.cic.gc.ca/en/application/profile/4989734'

  it('TRV session on the eapp review page: wrong portal, names the IRCC Portal, never the study text', () => {
    const page = classifyPortalPage(EAPP_REVIEW, 'ircc')
    expect(page.kind).toBe('wrong-portal')
    expect(page.message).toContain('IRCC Portal')
    expect(page.message).toContain('portal-portail.apps.cic.gc.ca')
    expect(page.message).toMatch(/visitor visa/)
    expect(page.message).not.toMatch(/questionnaire is done/)
  })

  it.each([
    ['ircc', EAPP_FORM],
    ['ircc', ETA],
    ['ircc', PR],
    ['ircc-eta', TRRT],
    ['ircc-eta', EAPP_FORM],
    ['ircc-study', TRRT],
    ['ircc-study', ETA],
    ['ircc-work', PR],
    ['ircc-pr-family', TRRT],
    ['ircc-pr-family', EAPP_REVIEW],
  ])('%s session on %s → wrong-portal', (portalId, url) => {
    const page = classifyPortalPage(url, portalId)
    expect(page.kind).toBe('wrong-portal')
    expect(page.message).toBeTruthy()
  })

  it.each([
    ['ircc', TRRT, 'form'],
    ['ircc', 'https://portal-portail.apps.cic.gc.ca/signin?lang=en', 'signin'],
    ['ircc', 'https://onlineservices-servicesenligne.cic.gc.ca/mycic/start', 'signin'],
    ['ircc-eta', ETA, 'form'],
    ['ircc-study', EAPP_FORM, 'form'],
    ['ircc-study', EAPP_REVIEW, 'review'],
    ['ircc-work', EAPP_REVIEW, 'review'],
    ['ircc-pr-family', PR, 'form'],
    ['ircc-pr-family', 'https://prson-srpel.apps.cic.gc.ca/en/login', 'signin'],
    // Unknown or absent portal: the old, unscoped behaviour.
    [undefined, EAPP_REVIEW, 'review'],
    [null, EAPP_REVIEW, 'review'],
    ['ircc-ee', EAPP_REVIEW, 'review'],
  ])('%s session on %s → %s', (portalId, url, kind) => {
    expect(classifyPortalPage(url, portalId).kind).toBe(kind)
  })

  it('names where each flow is applied for', () => {
    expect(classifyPortalPage(TRRT, 'ircc-eta').message).toMatch(/eTA/)
    expect(classifyPortalPage(TRRT, 'ircc-study').message).toMatch(/secure account/i)
    expect(classifyPortalPage(TRRT, 'ircc-pr-family').message).toMatch(/Permanent Residence Portal/)
  })
})
