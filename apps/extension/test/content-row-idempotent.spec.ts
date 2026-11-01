import { rowSummaryPresent } from '../src/executor/row-match'

/** Dry run 2026-10-16: a row already on the page is not added twice. */
describe('rowSummaryPresent', () => {
  it('matches the residence row IRCC shows', () => {
    expect(
      rowSummaryPresent('Pakistan — Citizen since 1961-06-15', ['Pakistan Citizen 1961-06-15 edit Edit delete_forever Delete']),
    ).toBe(true)
  })

  it('does not match a different row', () => {
    expect(
      rowSummaryPresent('Canada — Visitor since 2020-01-01', ['Pakistan Citizen 1961-06-15 edit Edit delete_forever Delete']),
    ).toBe(false)
    expect(rowSummaryPresent('Mian Muhammad Sajawal (Son, born 1989-10-14)', ['Mian Muhammad Bilawal Son 1989-10-14'])).toBe(
      false,
    )
  })

  it('needs whole words: a number inside another number is not a match', () => {
    expect(rowSummaryPresent('Retired since 2016-10', ['Retired 2016-10-01'])).toBe(false)
  })
})

import { pickActivePortalTab } from '../src/portal-tab'

describe('pickActivePortalTab (dry run 2026-10-17)', () => {
  const ircc = 'https://tr-rt.apps.cic.gc.ca/bio-data?lang=en'
  it('binds only to the portal tab in front', () => {
    expect(pickActivePortalTab([{ id: 1, active: true, url: ircc }])).toBe(1)
  })
  it('never to a background portal tab, which Chrome may have frozen', () => {
    expect(pickActivePortalTab([{ id: 1, active: false, url: ircc }, { id: 2, active: true, url: 'https://visaai.co/x' }])).toBeNull()
  })
})
