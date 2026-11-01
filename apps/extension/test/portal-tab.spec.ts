import { pickPortalTab } from '../src/portal-tab'

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
