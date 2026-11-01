/**
 * Build/runtime identity of this API process. The same codebase serves the
 * global site (visaai.co, every supported destination) and the Canada-only
 * site (visaai.ca, SITE_MODE=canada). Every country-scoping decision goes
 * through these helpers so global mode stays byte-for-byte unchanged: a null
 * scope means "no restriction".
 */
export type SiteMode = 'global' | 'canada';

const CANADA_SCOPE: readonly string[] = ['CA'];

/** Reads SITE_MODE; a missing ConfigService (unit tests) means global. */
export interface SiteModeSource {
  get(key: 'SITE_MODE', options?: { infer: true }): unknown;
}

export function readSiteMode(config?: SiteModeSource | null): SiteMode {
  const mode = config?.get('SITE_MODE', { infer: true });
  return mode === 'canada' ? 'canada' : 'global';
}

/** Destination countries this site serves, or null when unrestricted. */
export function siteCountryScope(mode: SiteMode): readonly string[] | null {
  return mode === 'canada' ? CANADA_SCOPE : null;
}

export function isCountryInSiteScope(
  mode: SiteMode,
  code: string | null | undefined,
): boolean {
  const scope = siteCountryScope(mode);
  if (scope === null) return true;
  return !!code && scope.includes(code.toUpperCase());
}

/** The single country a scoped site is pinned to, or null when unrestricted. */
export function siteDefaultCountry(mode: SiteMode): string | null {
  const scope = siteCountryScope(mode);
  return scope && scope.length === 1 ? scope[0] : null;
}
