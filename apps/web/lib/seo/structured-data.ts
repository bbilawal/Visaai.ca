/**
 * JSON-LD structured data (SEO-00x).
 *
 * Only facts the site can stand behind go in here. Schema.org markup is a claim
 * made to search engines and AI answer engines in a machine-readable form —
 * inventing a rating, a review count, a price or a founding date to fill a
 * recommended field is fabricated data with a wider blast radius than a bad
 * paragraph, because it gets quoted back as fact.
 *
 * So: no `aggregateRating`, no `review`, no `foundingDate`, no employee count.
 * If a field is not verifiable from the product itself, it is absent.
 */
import { SITE_BRAND } from '@/lib/site-config'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

/** Serialise for a <script type="application/ld+json"> tag. */
export function jsonLd(data: Record<string, unknown>): string {
  // `<` is escaped so a value can never close the script element early. Every
  // value here is a build-time constant today, but that is a property of the
  // current callers, not of the function.
  return JSON.stringify(data).replace(/</g, '\\u003c')
}

/**
 * The publisher. `name`, `url` and `description` are the only claims made.
 */
export function organizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_BRAND,
    url: SITE_URL,
    // Absolute URL: Google rejects a relative `logo`, and this is what feeds
    // the knowledge-panel / rich-result brand image.
    logo: `${SITE_URL}/brand/mark-v3-512.png`,
    image: `${SITE_URL}/brand/og-v3.png`,
    description:
      'AI-powered immigration copilot for preparing and verifying visa applications.',
  }
}

/**
 * The product. `WebApplication` rather than `SoftwareApplication` because it is
 * browser-delivered. No `offers` block: pricing is plan-dependent and varies by
 * corridor, and a wrong price in structured data is quoted as fact.
 */
export function webApplicationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: SITE_BRAND,
    url: SITE_URL,
    image: `${SITE_URL}/brand/og-v3.png`,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Any',
    description:
      'Prepare stronger visa applications with AI-powered guidance, document verification and readiness scoring.',
  }
}
