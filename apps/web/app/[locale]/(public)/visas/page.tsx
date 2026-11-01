import type { Metadata } from 'next'
import { Link } from '@/i18n/navigation'
import { localeAlternates } from '@/lib/seo/alternates'
import { listPublishedCountries } from '@/lib/visa-registry'
import { SITE_URL } from '@/lib/seo/site'

/**
 * The public visa index: /visas
 *
 * WHY THIS EXISTS
 *
 * Before this route the entire public surface was six pages — `/`, `/pricing`,
 * `/privacy`, `/terms`, `/login`, `/signup` — and `/` 307s logged-out visitors
 * straight into the application funnel. So VisaAI published nothing about
 * visas, on a site about visas, and had no page that could rank for or be
 * cited on any visa question.
 *
 * This is also the fix for the orphaned-page problem: `/pricing` had zero
 * inbound internal links and `/applications/new` had zero outbound ones, so no
 * authority moved anywhere. The hub links down to every country and every
 * country page links back.
 *
 * Every fact on these pages is either the authority's own wording or a link to
 * the government page that states it. Nothing here is VisaAI's opinion about
 * what a government requires.
 */

export const revalidate = 3600

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  return {
    title: 'Visa information by country — VisaAI',
    description:
      'Official visa categories, authorities and application pages for each destination VisaAI covers, with a link to the government source for every entry.',
    alternates: localeAlternates('/visas', locale),
  }
}

export default async function VisasIndexPage() {
  const countries = await listPublishedCountries()

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Visa information by country',
    itemListElement: countries.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      url: `${SITE_URL}/visas/${c.slug}`,
    })),
  }

  return (
    <main className="mx-auto max-w-[860px] px-5 py-12 md:py-16">
      {/*
        ItemList rather than a decorative schema type: it describes exactly what
        is visible on the page, which is the only structured data worth
        emitting. Nothing here claims a rating, a review or an offer.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList) }}
      />

      <nav aria-label="Breadcrumb" className="mb-6 text-[13px] text-midtone-gray">
        <Link href="/" className="underline">
          Home
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">Visas</span>
      </nav>

      <p className="eyebrow mb-2">Reference</p>
      <h1 className="type-h1 mb-3">Visa information by country</h1>
      <p className="lede mb-8 max-w-[640px]">
        The visa categories each authority actually publishes, with a direct
        link to the official page for every one. VisaAI does not issue visas and
        cannot decide an application — these pages exist so you can check the
        source yourself.
      </p>

      {countries.length === 0 ? (
        <p className="text-[14px] text-midtone-gray">
          No destinations are published yet.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {countries.map((c) => (
            <li key={c.code}>
              <Link
                href={`/visas/${c.slug}`}
                className="block rounded-lg border border-hairline-2 p-4 hover:bg-atmosphere-wash"
              >
                <span className="block type-h3">{c.name}</span>
                {c.immigration_authority ? (
                  <span className="block text-[13px] text-midtone-gray">
                    {c.immigration_authority}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-10 text-[13px] text-midtone-gray">
        Ready to prepare an application?{' '}
        <Link href="/applications/new" className="underline">
          Start a free assessment
        </Link>
        , or see{' '}
        <Link href="/pricing" className="underline">
          pricing
        </Link>
        .
      </p>
    </main>
  )
}
