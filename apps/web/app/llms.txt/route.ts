import { SITE_URL } from '@/lib/seo/site'
import { listPublishedCountries, listPublishableVisaPages } from '@/lib/visa-registry'

/**
 * `/llms.txt` — an AI-readable index of the published visa pages.
 *
 * §42 permits this ONLY as a low-risk supplementary aid, under conditions that
 * are worth restating because they are what make it defensible rather than
 * cargo-culted:
 *
 *   accurate                — every entry is read from the registry at request
 *                             time, so it cannot describe a page that is not
 *                             published or miss one that is.
 *   automatically maintained — there is no hand-written list here. That is the
 *                             binding condition: a manifest somebody edits by
 *                             hand goes stale the first week nobody remembers
 *                             it, which is the exact failure this codebase has
 *                             hit repeatedly (a doc reading "20 sources" after
 *                             the count reached 31).
 *   no private data          — it lists only what `visa_publishable_pages`
 *                             already publishes, which is the same gate the
 *                             sitemap and the public routes use.
 *   supplementary            — it replaces nothing. robots.txt, the sitemap,
 *                             the structured data and the HTML pages are all
 *                             unchanged and remain the real interfaces.
 *
 * And the last condition, which belongs in the file itself rather than only in
 * a doc: llms.txt is an experimental community convention, not a standard and
 * not a ranking mechanism. The response says so in its own header, because the
 * people most likely to read this file are the ones most likely to assume
 * otherwise.
 *
 * Revalidated hourly: the registry changes on the order of days, and a
 * per-request database read for a crawler-facing file is a free denial of
 * service.
 */
export const revalidate = 3600
export const dynamic = 'force-static'

export async function GET(): Promise<Response> {
  const lines: string[] = []
  const w = (s = '') => lines.push(s)

  w('# VisaAI')
  w()
  w('> Official-source visa requirements. Every requirement published on this')
  w('> site is bound to a verbatim excerpt from the issuing government’s own')
  w('> page, with the source URL and the date it was last verified shown')
  w('> alongside it. Nothing is published without that binding.')
  w()
  w('This file is generated from the live registry on request. It is an')
  w('experimental community convention, not a standard, not a ranking')
  w('mechanism, and not a substitute for robots.txt, the sitemap or the pages')
  w('themselves — all of which remain authoritative.')
  w()
  w('VisaAI is not a law firm and does not give legal advice. Requirements')
  w('change; the authority’s own page is always the final word, and every page')
  w('here links to it.')
  w()

  try {
    const [countries, pages] = await Promise.all([
      listPublishedCountries(),
      listPublishableVisaPages(),
    ])

    const byCountry = new Map<string, typeof pages>()
    for (const p of pages) {
      const list = byCountry.get(p.country_slug) ?? []
      list.push(p)
      byCountry.set(p.country_slug, list)
    }

    w('## Destinations')
    w()
    for (const c of countries) {
      w(`- [${c.name}](${SITE_URL}/visas/${c.slug}): visa routes and the`)
      w(`  official authority for ${c.name}.`)
    }
    w()

    w('## Visa routes')
    w()
    for (const c of countries) {
      const list = byCountry.get(c.slug)
      if (!list?.length) continue
      w(`### ${c.name}`)
      w()
      for (const p of list) {
        const verified = p.last_verified_at
          ? ` Last verified ${String(p.last_verified_at).slice(0, 10)}.`
          : ''
        w(
          `- [${p.official_name ?? p.visa_slug}](${SITE_URL}/visas/${p.country_slug}/${p.visa_slug}):` +
            ` requirements quoted from the issuing authority.${verified}`,
        )
      }
      w()
    }
  } catch {
    // Degrade to the header rather than serving a half-list that reads as
    // complete. An index that silently drops destinations is worse than one
    // that says it could not be built.
    w('## Destinations')
    w()
    w('The registry could not be read when this file was generated, so no')
    w('routes are listed. See the sitemap at /sitemap.xml, which is generated')
    w('separately.')
    w()
  }

  return new Response(lines.join('\n') + '\n', {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  })
}
