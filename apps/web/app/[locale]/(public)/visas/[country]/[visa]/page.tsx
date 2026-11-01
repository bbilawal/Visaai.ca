import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Link } from '@/i18n/navigation'
import { bucketOf, type Bucket } from '@/lib/visa-requirement-buckets'
import { amounts } from '@/lib/visa-amounts'
import { localeAlternates } from '@/lib/seo/alternates'
import { SITE_URL } from '@/lib/seo/site'
import {
  CATEGORY_LABELS,
  SOURCE_ROLE_LABELS,
  getCountryBySlug,
  getVisaType,
  listPublishableVisaPages,
  listRequirements,
  listSources,
  listVisaTypes,
} from '@/lib/visa-registry'
import { VerifiedStamp } from '@/components/visas/verified-stamp'
import { OfficialSourceList } from '@/components/visas/official-source-list'
import { SITE_BRAND } from '@/lib/site-config'

/**
 * Visa detail page: /visas/{country}/{visa}
 *
 * THE PUBLICATION GATE
 *
 * This page renders for any active visa type, but it is only INDEXABLE when it
 * appears in `visa_publishable_pages` — the database view that requires a
 * supported country, an active visa type, at least one active official
 * requirement and at least one active official source. Anything short of that
 * renders with `robots: noindex, follow`.
 *
 * That distinction is deliberate rather than defensive. A page listing a
 * government's official visa name, code and source links is useful to a person
 * who lands on it and should stay reachable and followable. It is not useful to
 * a search index until it has the requirements that would make it worth
 * ranking, and mass-indexing near-empty pages is exactly the thin-content
 * behaviour the spec bans.
 *
 * The gate lives in SQL, not here, so the sitemap and this renderer cannot
 * disagree about which pages are publishable.
 */

export const revalidate = 3600

export async function generateStaticParams() {
  // Only publishable pages are pre-rendered. The rest are generated on demand
  // and marked noindex — no build time spent on pages that should not rank.
  const pages = await listPublishableVisaPages()
  return pages.map((p) => ({ country: p.country_slug, visa: p.visa_slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; country: string; visa: string }>
}): Promise<Metadata> {
  const { locale, country, visa } = await params
  const c = await getCountryBySlug(country)
  if (!c) return {}
  const t = await getVisaType(c.code, visa)
  if (!t) return {}

  const publishable = (await listPublishableVisaPages()).some(
    (p) => p.country_slug === country && p.visa_slug === visa,
  )
  const reqs = await listRequirements(t.visaai_id)
  const officialCount = reqs.filter((r) => r.officially_required).length

  return {
    // The authority's own name for the visa is the title, because that is what
    // people search for — "subclass 600", "Standard Visitor visa", "B-1/B-2".
    title: `${t.official_name} — ${c.name} | ${SITE_BRAND}`,
    description: publishable
      ? `${officialCount} official requirement${officialCount === 1 ? '' : 's'} for the ${t.official_name} in ${c.name}, each traced to ${c.immigration_authority ?? 'the issuing authority'}.`
      : `Official ${c.name} ${t.official_name} information and government source links.`,
    alternates: localeAlternates(`/visas/${country}/${visa}`, locale),
    robots: publishable ? undefined : { index: false, follow: true },
    openGraph: {
      title: `${t.official_name} — ${c.name}`,
      url: `${SITE_URL}/visas/${country}/${visa}`,
      type: 'article',
    },
  }
}


export default async function VisaDetailPage({
  params,
}: {
  params: Promise<{ country: string; visa: string }>
}) {
  const { country, visa } = await params
  const c = await getCountryBySlug(country)
  if (!c) notFound()
  const t = await getVisaType(c.code, visa)
  if (!t) notFound()

  const [requirements, sources, allTypes] = await Promise.all([
    listRequirements(t.visaai_id),
    listSources(c.code, t.visaai_id),
    listVisaTypes(c.code),
  ])

  /**
   * The other routes this authority offers.
   *
   * Every detail page used to be a leaf: the only internal links it carried
   * were the two breadcrumb up-links, so a reader who opened the wrong visa had
   * to go back to the hub to find the right one, and the country's routes were
   * connected to each other only through that hub.
   *
   * Sibling links are worth more here than the usual "related content" filler
   * because the choice between routes IS the applicant's actual problem — most
   * people arrive knowing where they want to go and not which visa that needs.
   */
  const siblings = allTypes.filter((v) => v.visaai_id !== t.visaai_id)

  // Split by whether the AUTHORITY says it is required. These never share a
  // list: the whole point of `kind = 'recommended'` being a separate kind
  // rather than a boolean is that a template cannot accidentally render
  // VisaAI's advice as a government rule.
  //
  // Sections come from bucketOf, not from filters written here. The page used
  // to filter inline and anything matching no filter rendered nowhere; see
  // lib/visa-requirement-buckets.ts. Keeping the split in one tested place is
  // what stops that recurring — a second copy of the logic here would make the
  // exhaustiveness test guard something the page does not use.
  const inBucket = (b: Bucket) => requirements.filter((r) => bucketOf(r) === b)
  const official = requirements.filter((r) => r.officially_required)
  const forms = inBucket('form')
  const evidence = inBucket('evidence')
  const conditions = inBucket('condition')
  const steps = inBucket('step')
  const fees = inBucket('fee')
  const suggestions = inBucket('suggestion')

  // Everything the AUTHORITY states that is not itself a requirement, and is
  // not VisaAI's advice either.
  //
  // This bucket had no section and rendered NOWHERE — 31 entries across 18 of
  // 34 pages vanished silently. The worst case was the Dutch orientation year,
  // whose eligibility is four ALTERNATIVE routes ("one of these situations
  // applies to you"). Each is officially_required = false precisely so the page
  // does not claim an applicant needs all four — and the effect was a page that
  // never said who qualifies at all.
  //
  // The bucket is heterogeneous by nature: alternative routes, exemptions that
  // switch a requirement off (a Swedish citizen partner need not meet the
  // maintenance requirement), rights attached to the permit, optional faster
  // paths, and the authority's own warnings. What they share is the only thing
  // that matters for the heading: the government says it, and it is not
  // something you must do.
  //
  // It stays a SEPARATE list from the official ones for the same reason
  // `recommended` is a distinct kind — so a template cannot render "you may be
  // exempt" where a reader is looking for "you must".
  const alsoStated = inBucket('alsoStated')

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
      {
        '@type': 'ListItem',
        position: 4,
        name: t.official_name,
        item: `${SITE_URL}/visas/${c.slug}/${t.slug}`,
      },
    ],
  }

  /**
   * How many requirements can actually show the authority's words. Zero is a
   * real state — every source on this route may be unreadable, or the
   * derivation may have refused — and the explanatory note must not promise
   * quotations that are not there.
   */
  const quotedCount = requirements.filter((r) => r.source_excerpt_display).length

  const section = (
    title: string,
    items: typeof requirements,
    note?: string,
  ) =>
    items.length === 0 ? null : (
      <section className="mb-8">
        <h2 className="type-h3 mb-1">{title}</h2>
        {note ? <p className="mb-3 text-[13px] text-midtone-gray">{note}</p> : null}
        <ul className="grid gap-2">
          {items.map((r) => (
            <li key={r.requirement_code} className="text-[14px]">
              <span className="font-medium">{r.label}</span>
              {r.official_form_code ? (
                <span className="text-midtone-gray"> ({r.official_form_code})</span>
              ) : null}
              {amounts(r.parameters) ? (
                <span className="block text-[13px] font-medium text-deep-black">
                  {amounts(r.parameters)}
                </span>
              ) : null}
              {r.description ? (
                <span className="block text-[13px] text-midtone-gray">
                  {r.description}
                </span>
              ) : null}
              {/*
                The authority's own words, and the reason this registry exists.
                Everything above this line — label, description — is VisaAI's
                characterisation of the rule. This is the government's.

                Rendered ONLY from `source_excerpt_display`, which carries the
                authority's own capitalisation. `source_excerpt` is lowercased
                by the monitor's normalizer and must never appear inside
                quotation marks: quoting our own processing artifacts as a
                government's words is BUG_LOG D-11.

                A null renders nothing. That is the honest degradation — the
                claim is still there with its source listed below, just without
                a quote we cannot vouch for the wording of.

                Never truncated. A shortened quotation asserts the authority
                said less than it did, which is the undeclared-elision failure
                the extraction rules forbid; a declared cut appears as " ... ".
              */}
              {r.source_excerpt_display ? (
                <blockquote className="mt-1 border-l-2 border-hairline-2 pl-3 text-[13px] text-midtone-gray">
                  {r.source_excerpt_display}
                </blockquote>
              ) : null}
              {r.official_form_url ? (
                <a href={r.official_form_url} className="text-[13px] underline" rel="noopener">
                  Official form
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    )

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
        <Link href={`/visas/${c.slug}`} className="underline">
          {c.name}
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{t.official_name}</span>
      </nav>

      <p className="eyebrow mb-2">
        {c.name} · {CATEGORY_LABELS[t.category] ?? t.category}
      </p>
      <h1 className="type-h1 mb-3">{t.official_name}</h1>

      {/* Direct-answer block: the summary an answer engine can lift verbatim. */}
      <p className="lede mb-4 max-w-[640px]">
        {t.official_name}
        {t.official_code ? ` (${t.official_code})` : ''} is issued by{' '}
        {c.immigration_authority ?? c.name}.{' '}
        {official.length > 0
          ? `VisaAI tracks ${official.length} official requirement${official.length === 1 ? '' : 's'} for it, each traced to the government page that states it.`
          : 'Its official requirements have not been extracted and reviewed yet — use the government links below.'}
      </p>

      <VerifiedStamp verifiedAt={t.last_verified_at ?? c.last_verified_at} />

      <div className="mb-10 mt-6 rounded-lg border border-hairline-2 p-4 text-[13px]">
        <p className="mb-1">
          <strong>VisaAI is not a government body and does not issue visas.</strong>{' '}
          It cannot decide, predict or guarantee the outcome of an application,
          and this page is not legal or immigration advice.
        </p>
        <p className="text-midtone-gray">
          Requirements change. Confirm every item on{' '}
          {c.immigration_authority ?? 'the authority'}&rsquo;s own page before you
          apply.
        </p>
      </div>

      {/*
        Said once, above the lists, rather than repeated beside every quotation.
        Readers need to know which words are the government's and which are
        ours, and only rendered when there is at least one quote to explain.
      */}
      {official.length > 0 && quotedCount > 0 ? (
        <p className="mb-6 text-[13px] text-midtone-gray">
          Each requirement below is written in plain English by VisaAI. The
          indented text beneath it is quoted from{' '}
          {c.immigration_authority ?? 'the authority'}&rsquo;s own page, so you
          can check what we say against what they say. Where a quotation shows{' '}
          <span className="whitespace-nowrap">&ldquo; ... &rdquo;</span>, text has
          been left out.
        </p>
      ) : null}

      {official.length === 0 ? (
        <section className="mb-8 rounded-lg border border-hairline-2 p-4">
          <h2 className="type-h3 mb-2">Requirements not yet published</h2>
          <p className="text-[14px] text-midtone-gray">
            VisaAI publishes a requirement only once it has been read from a
            specific version of an official page and reviewed. That has not
            happened for this visa yet, so nothing is listed here rather than
            something unverified being listed. The official sources below are
            the authority&rsquo;s own pages.
          </p>
        </section>
      ) : (
        <>
          {section('Conditions you must meet', conditions)}
          {section('Official forms', forms)}
          {section('Documents you must provide', evidence)}
          {section('Steps in the process', steps)}
          {section('Government fees', fees)}
        </>
      )}

      {alsoStated.length > 0
        ? section(
            'Also stated by the authority',
            alsoStated,
            'Not requirements in themselves. These are alternatives, exemptions, rights and warnings the authority publishes alongside the requirements — quoted here because they can change what applies to you.',
          )
        : null}

      {suggestions.length > 0
        ? section(
            'VisaAI suggestions',
            suggestions,
            'Not required by the authority. These are VisaAI’s suggestions for presenting a clearer application.',
          )
        : null}

      <section className="mt-10">
        <h2 className="type-h3 mb-3">Official sources</h2>
        <OfficialSourceList sources={sources} roleLabels={SOURCE_ROLE_LABELS} />
      </section>

      {siblings.length > 0 ? (
        <section className="mt-10">
          <h2 className="type-h3 mb-3">Other {c.name} visas</h2>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {siblings.map((v) => (
              <li key={v.visaai_id}>
                <Link
                  href={`/visas/${c.slug}/${v.slug}`}
                  className="text-[14px] underline"
                >
                  {v.official_name}
                </Link>
                {v.official_code ? (
                  <span className="ml-1.5 text-[12px] text-midtone-gray">
                    {v.official_code}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="mt-10 text-[13px] text-midtone-gray">
        <Link href={`/visas/${c.slug}`} className="underline">
          All {c.name} visa types
        </Link>
        {' · '}
        <Link href="/applications/new" className="underline">
          Start a free assessment
        </Link>
      </p>
    </main>
  )
}
