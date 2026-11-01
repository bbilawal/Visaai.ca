import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { localeAlternates } from '@/lib/seo/alternates'

/**
 * Metadata-only layout.
 *
 * `page.tsx` here is a client component, which cannot export
 * `generateMetadata`. Without this segment layout the route emitted no
 * canonical and no hreflang at all — while `sitemap.xml` declared 15 alternates
 * for it. A one-sided hreflang declaration is discarded by search engines, so
 * the sitemap's claim was doing nothing.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  return { alternates: localeAlternates('/signup', locale) }
}

export default function SignupLayout({ children }: { children: ReactNode }) {
  return children
}
