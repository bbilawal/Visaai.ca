import { SITE_CONFIG } from '@/lib/site-config'

/**
 * The canonical origin, in one place.
 *
 * It was duplicated across app/sitemap.ts and app/robots.ts with different
 * fallbacks — sitemap fell back to `https://visaai.co`, robots to
 * `http://localhost:3000`. When NEXT_PUBLIC_SITE_URL is unset those two files
 * disagree about what site this is, and a sitemap advertising one host while
 * robots advertises another is the kind of mismatch that quietly costs an
 * index.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? SITE_CONFIG.siteUrl
).replace(/\/$/, '')

/** Absolute URL for a root-relative path. */
export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path === '/' ? '' : path}` || SITE_URL
}
