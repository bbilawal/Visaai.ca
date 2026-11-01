import { pickPortalTab, pickPortalTabToFocus } from '../src/portal-tab'

const visa = { id: 1, url: 'https://visaai.co/submission/x', active: true }
const ircc = { id: 2, url: 'https://tr-rt.apps.cic.gc.ca/purpose?appId=1', active: false }

describe('pickPortalTab', () => {
  it('binds the active tab when it is the portal', () => {
    expect(pickPortalTab([{ ...visa, active: false }, { ...ircc, active: true }])).toBe(2)
  })

  it('binds the single portal tab when launched from the VisaAI tab', () => {
    expect(pickPortalTab([visa, ircc])).toBe(2)
  })

  it('refuses to guess between two portal tabs', () => {
    expect(pickPortalTab([visa, ircc, { ...ircc, id: 3 }])).toBeNull()
  })

  it('refuses non-https and look-alike hosts', () => {
    expect(pickPortalTab([visa, { id: 4, url: 'http://tr-rt.apps.cic.gc.ca/x' }])).toBeNull()
    expect(pickPortalTab([visa, { id: 5, url: 'https://cic.gc.ca.evil.com/x' }])).toBeNull()
  })
})

describe('pickPortalTabToFocus (Launch brings the portal to the front)', () => {
  const VISAAI = { id: 1, url: 'https://visaai.co/submission/x', active: true, lastAccessed: 50 }
  it('picks the form page over the account page', () => {
    expect(
      pickPortalTabToFocus([
        VISAAI,
        { id: 2, url: 'https://portal-portail.apps.cic.gc.ca/home', lastAccessed: 40 },
        { id: 3, url: 'https://tr-rt.apps.cic.gc.ca/doc-upload?x=1', lastAccessed: 10 },
      ]),
    ).toBe(3)
  })
  it('the most recently used form page of several', () => {
    expect(
      pickPortalTabToFocus([
        { id: 3, url: 'https://tr-rt.apps.cic.gc.ca/purpose', lastAccessed: 10 },
        { id: 4, url: 'https://tr-rt.apps.cic.gc.ca/bio-data', lastAccessed: 30 },
      ]),
    ).toBe(4)
  })
  it('a sign-in page when that is all there is, so the panel can say what to do', () => {
    expect(pickPortalTabToFocus([VISAAI, { id: 2, url: 'https://portal-portail.apps.cic.gc.ca/signin' }])).toBe(2)
  })
  it('nothing without a portal tab', () => {
    expect(pickPortalTabToFocus([VISAAI, { id: 5, url: 'https://example.com/' }])).toBeNull()
  })

  describe('with the pages of this application', () => {
    const IRCC_PAGES = ['/purpose', '/bio-data', '/doc-upload']
    const ETA = { id: 7, url: 'https://eta.onlineservices-servicesenligne.apps.cic.gc.ca/eta/welcome?lang=en', lastAccessed: 90 }
    const HOME = { id: 2, url: 'https://portal-portail.apps.cic.gc.ca/home?lang=en', lastAccessed: 20 }
    it("live 2026-10-17: a leftover eTA tab does not beat the visitor-visa account tab", () => {
      expect(pickPortalTabToFocus([VISAAI, ETA, HOME], IRCC_PAGES)).toBe(2)
    })
    it('a page this fill covers wins', () => {
      const doc = { id: 3, url: 'https://tr-rt.apps.cic.gc.ca/doc-upload', lastAccessed: 10 }
      expect(pickPortalTabToFocus([VISAAI, ETA, HOME, doc], IRCC_PAGES)).toBe(3)
    })
    it('an unmapped page of the same application, when nothing better', () => {
      const review = { id: 4, url: 'https://tr-rt.apps.cic.gc.ca/review', lastAccessed: 10 }
      expect(pickPortalTabToFocus([VISAAI, ETA, review], IRCC_PAGES)).toBe(4)
    })
    it('an eTA application picks the eTA tab', () => {
      expect(pickPortalTabToFocus([VISAAI, HOME, ETA], ['/eta/welcome'])).toBe(7)
    })
    it('only another application open: stay put', () => {
      expect(pickPortalTabToFocus([VISAAI, ETA], IRCC_PAGES)).toBeNull()
    })
  })
})
