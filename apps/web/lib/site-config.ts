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
