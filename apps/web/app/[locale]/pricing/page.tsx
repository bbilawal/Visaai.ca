import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { PricingGrid, type PublicQuote } from './pricing-grid'
import { localeAlternates } from '@/lib/seo/alternates'
import {
  robotsForCoverage,
  translationCoverage,
} from '@/lib/seo/translation-coverage'
import { SITE_BRAND } from '@/lib/site-config'

/**
 * Revalidated, not force-dynamic.
 *
 * `force-dynamic` + `cache: 'no-store'` meant every request re-fetched the
 * quote API, and a failure had nothing to fall back on: the page still
 * returned HTTP 200, but with the pricing table — the only reason this page
 * exists and the thing it would rank for — replaced by a one-line
 * "unavailable" string. A crawler that arrived during an API blip indexed a
 * successful page with no pricing on it.
 *
 * Public quotes carry no user context and do not change per second, so a
 * revalidating cache is both correct and strictly better: Next serves the last
 * good render while it refreshes in the background, so an API blip is now
 * invisible rather than being published as the canonical version of the page.
 */
export const revalidate = 300

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations('pricing')

  // Index this locale variant only if the page is actually available in this
  // language. Fixing the canonical bug made all 14 non-English variants
  // eligible; without this, the ones still serving English become 14 duplicates
  // of the English page under 14 language tags. Self-maintaining: the day
  // someone translates the section, it starts being indexed.
  const [localeMessages, englishMessages] = await Promise.all([
    import(`@/messages/${locale}.json`).then((m) => m.default),
    import('@/messages/en.json').then((m) => m.default),
  ])
  const coverage = translationCoverage(locale, 'pricing', localeMessages, englishMessages)

  return {
    title: `${t('eyebrow')} — ${SITE_BRAND}`,
    description: t('heroLede'),
    alternates: localeAlternates('/pricing', locale),
    robots: robotsForCoverage(coverage),
  }
}

async function getQuotes(): Promise<PublicQuote[]> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
  // PRICE-001: this MUST throw on failure, not return [].
  //
  // The `revalidate = 300` above exists so Next keeps serving the last good
  // render while a refresh fails — but that fallback only engages when the
  // render THROWS. Catching the error and returning an empty array produced a
  // perfectly successful render with no prices in it, which Next then cached
  // and served as the new canonical pricing page. The failure the comment above
  // says this design prevents still happened; it just arrived by a different
  // route. Letting the error propagate is what actually arms the fallback.
  const res = await fetch(`${base}/pricing/quotes`, {
    next: { revalidate: 300 },
  })
  if (!res.ok) {
    throw new Error(`pricing quotes unavailable (HTTP ${res.status})`)
  }
  return (await res.json()) as PublicQuote[]
}

export default async function PricingPage() {
  const t = await getTranslations('pricing')
  const quotes = await getQuotes()

  return (
    <main className="mx-auto max-w-[1100px] px-5 py-12 md:py-16">
      {/* Hero — the free assessment is the real funnel entry (09 §1) */}
      <section className="mb-10 text-center">
        <p className="eyebrow mb-2">{t('eyebrow')}</p>
        <h1 className="type-h1 mb-3">{t('heroTitle')}</h1>
        <p className="lede mx-auto mb-6 max-w-[560px]">{t('heroLede')}</p>
        <Link href="/applications/new" className="btn btn-primary btn-lg">
          {t('assessCta')}
        </Link>
        <p className="mt-3 text-[12px] text-midtone-gray">{t('noCard')}</p>
      </section>

      {/* External anchor — every VisaAI price reads small against this (09 §2) */}
      <p className="mx-auto mb-10 max-w-[640px] text-center text-[14px] leading-relaxed text-midtone-gray">
        {t('anchor')}
      </p>

      {quotes.length > 0 ? (
        <PricingGrid quotes={quotes} />
      ) : (
        <p className="text-center text-[14px] text-midtone-gray">{t('unavailable')}</p>
      )}

      {/* Trust / risk-reversal (09 §2.3) */}
      <section className="mt-14 grid gap-6 text-center sm:grid-cols-3">
        {[1, 2, 3].map((n) => (
          <div key={n}>
            <h2 className="type-h3 mb-1">{t(`trust${n}Title`)}</h2>
            <p className="text-[13px] text-midtone-gray">{t(`trust${n}Body`)}</p>
          </div>
        ))}
      </section>
    </main>
  )
}
