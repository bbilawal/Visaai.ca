import { describe, expect, it } from 'vitest'
import { LOCALES, DEFAULT_LOCALE } from '@/i18n/config'
import { localeAlternates, localePath } from './alternates'

describe('localePath', () => {
  it('leaves the default locale unprefixed', () => {
    expect(localePath(DEFAULT_LOCALE, '/pricing')).toBe('/pricing')
    expect(localePath(DEFAULT_LOCALE, '/')).toBe('/')
  })

  it('prefixes every other locale', () => {
    expect(localePath('fr', '/pricing')).toBe('/fr/pricing')
    expect(localePath('ja', '/terms')).toBe('/ja/terms')
  })

  it('does not leave a trailing slash on a locale root', () => {
    // '/fr/' and '/fr' would be two URLs for one page.
    expect(localePath('fr', '/')).toBe('/fr')
  })
})

describe('localeAlternates', () => {
  it('makes each locale canonical to its OWN url', () => {
    // The regression: every locale canonicalised to the unprefixed English
    // URL, which told search engines the other 14 were duplicates and should
    // be dropped — 42 URLs pointing away from themselves.
    expect(localeAlternates('/pricing', 'fr').canonical).toBe('/fr/pricing')
    expect(localeAlternates('/pricing', 'de').canonical).toBe('/de/pricing')
    expect(localeAlternates('/pricing', 'en').canonical).toBe('/pricing')
  })

  it('never canonicalises a non-default locale to the default one', () => {
    for (const locale of LOCALES) {
      for (const path of ['/', '/pricing', '/privacy', '/terms']) {
        const { canonical } = localeAlternates(path, locale)
        if (locale !== DEFAULT_LOCALE) {
          expect(canonical.startsWith(`/${locale}`)).toBe(true)
        }
      }
    }
  })

  it('keeps canonical consistent with the hreflang entry for the same locale', () => {
    // A canonical that contradicts its own hreflang block makes Google discard
    // the cluster, so the page loses both its canonical and its language
    // targeting. They must agree.
    for (const locale of LOCALES) {
      const alts = localeAlternates('/terms', locale)
      expect(alts.canonical).toBe(alts.languages[locale])
    }
  })

  it('lists every locale as an alternate, from every locale', () => {
    for (const locale of LOCALES) {
      const { languages } = localeAlternates('/privacy', locale)
      for (const l of LOCALES) expect(languages[l]).toBeDefined()
    }
  })

  it('points x-default at the unprefixed english url', () => {
    // x-default is for a visitor whose language matches none of the 15.
    expect(localeAlternates('/pricing', 'ar').languages['x-default']).toBe('/pricing')
    expect(localeAlternates('/', 'ja').languages['x-default']).toBe('/')
  })

  it('emits self-referencing alternates, which is what makes a cluster valid', () => {
    const alts = localeAlternates('/pricing', 'ur')
    expect(alts.languages['ur']).toBe('/ur/pricing')
  })
})
