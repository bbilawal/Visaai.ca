import { describe, expect, it } from 'vitest'
import { localizeCountries, localizeCountryName } from './localize-country-name'
import type { SupportedCountry } from './use-supported-countries'

/**
 * The bug these cover: the destination picker translated everything about
 * itself EXCEPT the countries. On /ur/applications/new the heading, the labels,
 * the placeholder and the button were all Urdu, and the options read
 * "Australia", "United States", "Canada" — because `GET /countries` returns the
 * strategy registry's English `name` and nothing downstream ever localised it.
 */
describe('localizeCountryName', () => {
  it('translates an ISO-2 code into the requested locale', () => {
    expect(localizeCountryName('DE', 'Germany', 'fr')).toBe('Allemagne')
    expect(localizeCountryName('US', 'United States', 'ur')).toBe(
      'ریاست ہائے متحدہ امریکہ',
    )
    expect(localizeCountryName('GB', 'United Kingdom', 'ja')).toBe('イギリス')
  })

  it('distinguishes zh from zh-TW rather than collapsing them', () => {
    // Simplified and traditional give genuinely different names, and a naive
    // `locale.split('-')[0]` would serve mainland names to Taiwan.
    expect(localizeCountryName('AU', 'Australia', 'zh')).toBe('澳大利亚')
    expect(localizeCountryName('AU', 'Australia', 'zh-TW')).toBe('澳洲')
  })

  it('keeps the English name in English', () => {
    expect(localizeCountryName('DE', 'Germany', 'en')).toBe('Germany')
  })

  it('KEEPS THE API NAME for SCHENGEN, which is not an ISO region', () => {
    // Intl.DisplayNames throws RangeError on a structurally invalid code. The
    // bloc is a real selectable option, so throwing here would empty the picker.
    expect(localizeCountryName('SCHENGEN', 'Schengen Area', 'fr')).toBe(
      'Schengen Area',
    )
  })

  it('falls back to the API name rather than inventing one', () => {
    // A well-formed but unassigned code yields "unknown region" text in some
    // locales — worse than the English name, because it looks authoritative.
    expect(localizeCountryName('ZZ', 'Nowhere', 'ur')).toBe('Nowhere')
    expect(localizeCountryName('', 'Nowhere', 'fr')).toBe('Nowhere')
    expect(localizeCountryName('DE', 'Germany', 'not-a-locale')).toBe('Germany')
  })
})

describe('localizeCountries', () => {
  const countries: SupportedCountry[] = [
    { code: 'AU', name: 'Australia', group: 'priority' },
    { code: 'US', name: 'United States', group: 'priority' },
    { code: 'CA', name: 'Canada', group: 'priority' },
    { code: 'GB', name: 'United Kingdom', group: 'priority' },
    { code: 'AT', name: 'Austria', group: 'schengen' },
    { code: 'DE', name: 'Germany', group: 'schengen' },
    { code: 'NL', name: 'Netherlands', group: 'schengen' },
  ]

  it('localises every name and leaves codes untouched', () => {
    const out = localizeCountries(countries, 'de')
    expect(out.find((c) => c.code === 'NL')?.name).toBe('Niederlande')
    expect(out.map((c) => c.code).sort()).toEqual(
      countries.map((c) => c.code).sort(),
    )
  })

  it('NEVER reorders the priority group', () => {
    // The four launch corridors are pinned in a fixed order the API sets. In
    // German they would alphabetise to Australien, Kanada, Vereinigte Staaten,
    // Vereinigtes Königreich — destroying the pinning.
    const out = localizeCountries(countries, 'de')
    expect(out.filter((c) => c.group === 'priority').map((c) => c.code)).toEqual(
      ['AU', 'US', 'CA', 'GB'],
    )
  })

  it('re-sorts the non-priority groups by the LOCALISED name', () => {
    // The API alphabetises by English name. Once translated that order is
    // wrong: in German, Niederlande sorts before Österreich.
    const out = localizeCountries(countries, 'de')
    expect(out.filter((c) => c.group === 'schengen').map((c) => c.name)).toEqual(
      ['Deutschland', 'Niederlande', 'Österreich'],
    )
  })

  it('keeps groups in their API order — priority, then the rest', () => {
    const out = localizeCountries(countries, 'de')
    const firstSchengen = out.findIndex((c) => c.group === 'schengen')
    const lastPriority = out.map((c) => c.group).lastIndexOf('priority')
    expect(lastPriority).toBeLessThan(firstSchengen)
  })

  it('returns the input unchanged for English', () => {
    expect(localizeCountries(countries, 'en')).toEqual(countries)
  })

  it('survives a country with no group', () => {
    const out = localizeCountries([{ code: 'DE', name: 'Germany' }], 'fr')
    expect(out).toEqual([{ code: 'DE', name: 'Allemagne' }])
  })

  it('does not mutate its input', () => {
    const input: SupportedCountry[] = [
      { code: 'DE', name: 'Germany', group: 'schengen' },
    ]
    localizeCountries(input, 'fr')
    expect(input[0].name).toBe('Germany')
  })
})
