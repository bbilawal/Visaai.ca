import { LOCALES, DEFAULT_LOCALE } from '@/i18n/config'

/**
 * Canonical + hreflang for one route, in one locale.
 *
 * TWO REGRESSIONS, ONE FILE.
 *
 * The first: the locale layout declared `alternates: { canonical: '/' }`, and
 * because no page overrode `alternates`, EVERY page inherited it. /pricing,
 * /privacy and /terms each told search engines they were duplicates of the
 * homepage. Fixed by declaring canonical per route, at the route.
 *
 * The second, which that fix left behind: `canonical` was still the UNPREFIXED
 * path. `/fr/pricing` rendered `<link rel="canonical" href="/pricing">`, as did
 * `/de/pricing`, `/ja/pricing` and the other twelve. So all 15 locale variants
 * of every page named the English URL as the original, which is an instruction
 * to index only the English one and drop the rest — 42 URLs
 * (14 non-default locales x 3 routes) pointing away from themselves.
 *
 * Worse, it contradicted the hreflang block emitted in the same <head>:
 * hreflang said "these 15 URLs are equivalent alternates, index each for its
 * language", canonical said "they are all copies of the English one". Google
 * resolves that conflict by discarding the hreflang cluster, so the localized
 * pages lost both their own canonical AND their language targeting.
 *
 * A page's canonical must be ITS OWN URL. `locale` is therefore required, and
 * the caller passes the locale it is rendering — `generateMetadata` receives it
 * in params, so nothing has to read headers() or opt out of static rendering.
 *
 * Paths stay root-relative; `metadataBase` in the layout makes them absolute,
 * which is what both rel=canonical and hreflang require.
 */

/** The path a given locale serves for a route. English is unprefixed (as-needed prefixing). */
export function localePath(locale: string, path: string): string {
  if (locale === DEFAULT_LOCALE) return path
  const suffix = path === '/' ? '' : path
  return `/${locale}${suffix}`
}

export function localeAlternates(path: string, locale: string) {
  const languages = Object.fromEntries(
    LOCALES.map((l) => [l, localePath(l, path)]),
  )
  return {
    // This locale's own URL — not the English one.
    canonical: localePath(locale, path),
    languages: {
      ...languages,
      // x-default points at the unprefixed English URL: it is the version
      // served to a visitor whose language matches none of the 15, which is
      // exactly what x-default means.
      'x-default': path,
    },
  }
}
