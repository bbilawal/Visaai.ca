import {
  isCountryInSiteScope,
  readSiteMode,
  siteCountryScope,
  siteDefaultCountry,
} from './site-scope';

describe('site-scope', () => {
  const cfg = (mode: unknown) => ({ get: () => mode });

  it('reads canada only when SITE_MODE is exactly canada', () => {
    expect(readSiteMode(cfg('canada'))).toBe('canada');
    expect(readSiteMode(cfg('global'))).toBe('global');
    expect(readSiteMode(cfg(undefined))).toBe('global');
    expect(readSiteMode(undefined)).toBe('global');
  });

  it('global mode is unrestricted', () => {
    expect(siteCountryScope('global')).toBeNull();
    expect(siteDefaultCountry('global')).toBeNull();
    expect(isCountryInSiteScope('global', 'FR')).toBe(true);
    expect(isCountryInSiteScope('global', null)).toBe(true);
  });

  it('canada mode allows CA only (case-insensitive)', () => {
    expect(siteCountryScope('canada')).toEqual(['CA']);
    expect(siteDefaultCountry('canada')).toBe('CA');
    expect(isCountryInSiteScope('canada', 'CA')).toBe(true);
    expect(isCountryInSiteScope('canada', 'ca')).toBe(true);
    expect(isCountryInSiteScope('canada', 'US')).toBe(false);
    expect(isCountryInSiteScope('canada', null)).toBe(false);
  });
});
