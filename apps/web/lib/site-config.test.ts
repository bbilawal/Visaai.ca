import { afterEach, describe, expect, it, vi } from 'vitest'

async function load(mode?: string) {
  vi.resetModules()
  if (mode === undefined) vi.stubEnv('NEXT_PUBLIC_SITE_MODE', '')
  else vi.stubEnv('NEXT_PUBLIC_SITE_MODE', mode)
  return import('./site-config')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('site configuration', () => {
  it('global mode (no env var) is unrestricted', async () => {
    const m = await load()
    expect(m.SITE_CONFIG.mode).toBe('global')
    expect(m.SITE_CONFIG.countryScope).toBeNull()
    expect(m.SITE_BRAND).toBe('VisaAI')
    expect(m.SITE_DEFAULT_COUNTRY).toBeNull()
    expect(m.isCountryInSiteScope('FR')).toBe(true)
    const rows = [{ c: 'CA' }, { c: 'FR' }, { c: null }]
    expect(m.filterToSiteScope(rows, (r) => r.c)).toEqual(rows)
  })

  it('canada mode is pinned to CA', async () => {
    const m = await load('canada')
    expect(m.SITE_CONFIG.mode).toBe('canada')
    expect(m.SITE_CONFIG.countryScope).toEqual(['CA'])
    expect(m.SITE_BRAND).toBe('VisaAI Canada')
    expect(m.SITE_DEFAULT_COUNTRY).toBe('CA')
    expect(m.isCountryInSiteScope('ca')).toBe(true)
    expect(m.isCountryInSiteScope('FR')).toBe(false)
    expect(
      m.filterToSiteScope([{ c: 'CA' }, { c: 'FR' }, { c: null }], (r) => r.c),
    ).toEqual([{ c: 'CA' }, { c: null }])
  })

  it('any other value falls back to global', async () => {
    const m = await load('australia')
    expect(m.SITE_CONFIG.mode).toBe('global')
  })
})
