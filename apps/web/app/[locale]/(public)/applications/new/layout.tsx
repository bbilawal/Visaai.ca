import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { localeAlternates } from '@/lib/seo/alternates'
import { SITE_BRAND, SITE_DEFAULT_COUNTRY } from '@/lib/site-config'

/**
 * Metadata-only layout for the guest funnel's front door.
 *
 * This route matters more than its name suggests: `proxy.ts` sends every
 * logged-out visitor from `/` straight here, so it is the URL a crawler
 * actually indexes and the one external links land on. It emitted no canonical
 * and no hreflang, while the sitemap declared 15 alternates for it — a
 * one-sided declaration, which search engines discard.
 *
 * `page.tsx` is a client component and cannot export `generateMetadata`, hence
 * a layout that renders nothing but its children.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  return {
    title: SITE_DEFAULT_COUNTRY
      ? `Start a Canada visa application — ${SITE_BRAND}`
      : 'Start a visa application — VisaAI',
    description: SITE_DEFAULT_COUNTRY
      ? 'Start a free Canada visa assessment: choose your Canadian visa type in the guided intake. No account or card required.'
      : 'Choose your destination and get a free eligibility assessment. No account or card required.',
    alternates: localeAlternates('/applications/new', locale),
  }
}

export default function NewApplicationLayout({ children }: { children: ReactNode }) {
  return children
}
