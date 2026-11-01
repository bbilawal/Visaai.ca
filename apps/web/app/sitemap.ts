import type { MetadataRoute } from 'next'
import { LOCALES } from '@/i18n/config'
import { SITE_URL } from '@/lib/seo/site'
import { localePath } from '@/lib/seo/alternates'
import {
  listPublishableVisaPages,
  listPublishedCountries,
} from '@/lib/visa-registry'

/**
 * The sitemap, built from the same registry the pages render from.
 *
 * TWO FIXES OVER THE PREVIOUS VERSION.
 *
 * 1. `lastModified: new Date()`
 *
 *    Every entry carried the build time, so all 90 URLs claimed to change on
 *    every deploy. Proven at runtime: two fetches of the live sitemap returned
 *    an identical `2026-08-20T17:06:08.145Z`. A lastmod that moves when nothing
 *    changed is not a freshness signal, it is noise, and a crawler that learns
 *    the dates are meaningless stops using them — including on the day a page
 *    really did change.
 *
 *    Dates now come from the data: a visa page's lastmod is the date its
 *    country/visa was last verified against the official source. Static pages
 *    carry no lastmod at all, which is the honest answer for a page whose
 *    change date this file does not know. Omitting it is explicitly better than
 *    inventing one.
 *
 * 2. `/applications/new` was missing.
 *
 *    proxy.ts 307s every logged-out visitor from `/` to `/applications/new`, so
 *    all 15 root entries were redirects and the URL that actually gets indexed
 *    was absent from the sitemap entirely.
 *
 * The visa pages come from `visa_publishable_pages`, the same view the renderer
 * gates on, so the sitemap cannot advertise a URL the renderer marks noindex.
 */

export const revalidate = 3600

const STATIC_PATHS = [
  '',
  '/applications/new',
  '/visas',
  '/bots',
  '/pricing',
  '/privacy',
  '/terms',
  '/login',
  '/signup',
] as const

function entry(
  path: string,
  lastModified?: Date,
): MetadataRoute.Sitemap[number] {
  const languages = Object.fromEntries(
    LOCALES.map((l) => [l, `${SITE_URL}${localePath(l, path)}`]),
  )
  return {
    url: `${SITE_URL}${path}`,
    ...(lastModified ? { lastModified } : {}),
    alternates: {
      languages: {
        ...languages,
        // x-default was present on-page but missing from the sitemap; a
        // one-sided declaration is discarded.
        'x-default': `${SITE_URL}${path === '' ? '' : path}`,
      },
    },
  }
}

/**
 * One entry per (path, locale). The alternates block on each lists all 15, so
 * every localized URL both appears in the sitemap and declares its cluster —
 * the pairing hreflang requires.
 */
function localizedEntries(
  path: string,
  lastModified?: Date,
): MetadataRoute.Sitemap {
  return LOCALES.map((locale) => ({
    ...entry(path, lastModified),
    url: `${SITE_URL}${localePath(locale, path)}`,
  }))
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const out: MetadataRoute.Sitemap = STATIC_PATHS.flatMap((p) =>
    localizedEntries(p),
  )

  // A sitemap that throws takes the whole route down. The registry being
  // unreachable should cost the visa URLs, not the static ones.
  try {
    const [countries, visaPages] = await Promise.all([
      listPublishedCountries(),
      listPublishableVisaPages(),
    ])

    for (const c of countries) {
      out.push(
        ...localizedEntries(
          `/visas/${c.slug}`,
          c.last_verified_at ? new Date(c.last_verified_at) : undefined,
        ),
      )
    }

    for (const p of visaPages) {
      out.push(
        ...localizedEntries(
          `/visas/${p.country_slug}/${p.visa_slug}`,
          p.last_verified_at ? new Date(p.last_verified_at) : undefined,
        ),
      )
    }
  } catch {
    // Static entries still ship.
  }

  return out
}
