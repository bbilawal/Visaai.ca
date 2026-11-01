import { describe, expect, it } from 'vitest'
import { isCountryInSiteScope, SITE_CONFIG } from './site-config'

describe('site configuration', () => {
  it('has a valid site mode and scope', () => {
    expect(['global', 'canada']).toContain(SITE_CONFIG.mode)
    expect(SITE_CONFIG.mode === 'canada' ? SITE_CONFIG.countryScope : SITE_CONFIG.countryScope).toEqual(
      SITE_CONFIG.mode === 'canada' ? ['CA'] : null,
    )
    expect(isCountryInSiteScope('CA')).toBe(true)
  })
})
