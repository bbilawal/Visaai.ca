/** Build-time identity for the independently deployed global and Canada sites. */
export type SiteMode = 'global' | 'canada'

export interface SiteConfig {
  mode: SiteMode
  siteUrl: string
  countryScope: readonly string[] | null
}

const mode: SiteMode = process.env.NEXT_PUBLIC_SITE_MODE === 'canada' ? 'canada' : 'global'

export const SITE_CONFIG: SiteConfig = {
  mode,
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  countryScope: mode === 'canada' ? ['CA'] : null,
}

export function isCountryInSiteScope(code: string): boolean {
  return SITE_CONFIG.countryScope === null || SITE_CONFIG.countryScope.includes(code.toUpperCase())
}

/** Brand name for titles, metadata and generated text. */
export const SITE_BRAND: string = mode === 'canada' ? 'VisaAI Canada' : 'VisaAI'

/**
 * The single destination a scoped site is pinned to (Canada site: 'CA'), or
 * null on the global site, where the user picks a destination.
 */
export const SITE_DEFAULT_COUNTRY: string | null = mode === 'canada' ? 'CA' : null

/**
 * Drops rows whose destination is outside the site scope. Rows with no
 * destination yet are kept. A no-op on the global site.
 */
export function filterToSiteScope<T>(
  rows: readonly T[],
  getCode: (row: T) => string | null | undefined,
): T[] {
  if (SITE_CONFIG.countryScope === null) return [...rows]
  return rows.filter((row) => {
    const code = getCode(row)
    return !code || isCountryInSiteScope(code)
  })
}
