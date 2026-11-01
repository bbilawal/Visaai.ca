import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Link } from '@/i18n/navigation'
import { localeAlternates } from '@/lib/seo/alternates'
import { SITE_URL } from '@/lib/seo/site'
import {
  CATEGORY_LABELS,
  SOURCE_ROLE_LABELS,
  getCountryBySlug,
  listPublishedCountries,
  listSources,
  listVisaTypes,
} from '@/lib/visa-registry'
import { VerifiedStamp } from '@/components/visas/verified-stamp'
import { OfficialSourceList } from '@/components/visas/official-source-list'
import { SITE_BRAND } from '@/lib/site-config'

/**
 * Country visa hub: /visas/{country}
 *
 * WHAT THIS PAGE MAY CLAIM
 *
 * Only what the registry verified: the authority's name and URL, the visa
 * categories that authority publishes (in its own wording, with its own
 * subclass codes), and the official pages for each. It does NOT list
 * requirements — those live on the visa detail page and only exist once they
 * have been extracted from a source version and reviewed.
 *
 * That split is the point. A hub page backed by verified authorities and
 * verified official links is genuinely useful and fully sourced today; a
 * requirements page is not publishable until someone has read the government
 * page it would be quoting.
 */

export const revalidate = 3600

/**
 * Pre-render every published country at build time. There are tens of these,
 * not thousands, and a statically generated page is the one thing that
 * guarantees a crawler gets real HTML without waiting on a database.
 */
export async function generateStaticParams() {
  const countries = await listPublishedCountries()
  return countries.map((c) => ({ country: c.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; country: string }>
}): Promise<Metadata> {
  const { locale, country } = await params
  const c = await getCountryBySlug(country)
  if (!c) return {}

  const types = await listVisaTypes(c.code)
  return {
    title: `${c.name} visa types and official sources — ${SITE_BRAND}`,
    description:
      `The ${types.length} visa categories ${c.immigration_authority ?? c.name} publishes, ` +
      `each linked to its official government page. Last verified ${c.last_verified_at?.slice(0, 10) ?? 'n/a'}.`,
    alternates: localeAlternates(`/visas/${c.slug}`, locale),
    openGraph: {
      title: `${c.name} visa types — ${SITE_BRAND}`,
      url: `${SITE_URL}/visas/${c.slug}`,
      type: 'article',
    },
  }
}

export default async function CountryVisaHub({
  params,
}: {
  params: Promise<{ country: string }>
}) {
  const { country } = await params
  const c = await getCountryBySlug(country)
  if (!c) notFound()

  const [types, countrySources] = await Promise.all([
    listVisaTypes(c.code),
    listSources(c.code),
  ])

  const breadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Visas', item: `${SITE_URL}/visas` },
      {
        '@type': 'ListItem',
        position: 3,
        name: c.name,
        item: `${SITE_URL}/visas/${c.slug}`,
      },
    ],
  }

  const byCategory = new Map<string, typeof types>()
  for (const t of types) {
    const list = byCategory.get(t.category) ?? []
    list.push(t)
    byCategory.set(t.category, list)
  }

  return (
    <main className="mx-auto max-w-[860px] px-5 py-12 md:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }}
      />

      <nav aria-label="Breadcrumb" className="mb-6 text-[13px] text-midtone-gray">
        <Link href="/" className="underline">
          Home
        </Link>
        <span aria-hidden="true"> / </span>
        <Link href="/visas" className="underline">
          Visas
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{c.name}</span>
      </nav>

      <p className="eyebrow mb-2">{c.immigration_authority ?? 'Immigration authority'}</p>
      <h1 className="type-h1 mb-3">{c.name} visa types</h1>

      {/*
        The direct answer, first and in plain language — the block an answer
        engine can lift, and the thing a person came for.
      */}
      <p className="lede mb-4 max-w-[640px]">
        {c.immigration_authority ?? c.name} publishes {types.length} visa
        {types.length === 1 ? ' category' : ' categories'} that VisaAI tracks.
        Every entry below links to the official government page it came from.
      </p>

      <VerifiedStamp verifiedAt={c.last_verified_at} />

      <div className="mb-10 mt-6 rounded-lg border border-hairline-2 p-4 text-[13px]">
        <p className="mb-1">
          <strong>VisaAI is not a government body and does not issue visas.</strong>{' '}
          It cannot decide, predict or guarantee the outcome of an application.
        </p>
        <p className="text-midtone-gray">
          Always confirm requirements on the authority&rsquo;s own page before you
          apply.
        </p>
      </div>

      {types.length === 0 ? (
        <p className="text-[14px] text-midtone-gray">
          No visa categories are published for {c.name} yet.
        </p>
      ) : (
        [...byCategory.entries()].map(([category, list]) => (
          <section key={category} className="mb-8">
            <h2 className="type-h3 mb-3">
              {CATEGORY_LABELS[category] ?? category}
            </h2>
            <ul className="grid gap-3">
              {list.map((t) => (
                <li key={t.visaai_id}>
                  <Link
                    href={`/visas/${c.slug}/${t.slug}`}
                    className="block rounded-lg border border-hairline-2 p-4 hover:bg-atmosphere-wash"
                  >
                    {/*
                      The authority's exact wording, never a VisaAI paraphrase.
                      "Visitor visa (subclass 600)" is what the applicant will
                      see on the government form.
                    */}
                    <span className="block type-h3">{t.official_name}</span>
                    {t.official_code ? (
                      <span className="block text-[13px] text-midtone-gray">
                        Official code: {t.official_code}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <section className="mt-10">
        <h2 className="type-h3 mb-3">Official sources</h2>
        <OfficialSourceList
          sources={countrySources}
          roleLabels={SOURCE_ROLE_LABELS}
          extra={[
            c.official_visa_url
              ? {
                  role: 'index',
                  authority: c.immigration_authority ?? c.name,
                  canonical_url: c.official_visa_url,
                  title: 'Official visa options',
                  last_success_at: c.last_verified_at,
                }
              : null,
            c.evisa_portal_url
              ? {
                  role: 'application',
                  authority: c.immigration_authority ?? c.name,
                  canonical_url: c.evisa_portal_url,
                  title: 'Official travel authorisation portal',
                  last_success_at: c.last_verified_at,
                }
              : null,
          ].filter((x) => x !== null)}
        />
      </section>

      <p className="mt-10 text-[13px] text-midtone-gray">
        <Link href="/visas" className="underline">
          All destinations
        </Link>
        {' · '}
        <Link href="/applications/new" className="underline">
          Start a free assessment
        </Link>
        {' · '}
        <Link href="/pricing" className="underline">
          Pricing
        </Link>
      </p>
    </main>
  )
}
