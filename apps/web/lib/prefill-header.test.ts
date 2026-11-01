import { describe, expect, it } from 'vitest'
import { prefillHeaderParts } from './prefill-header'

/**
 * Prod 2026-10-14: the prefill header rendered "— · — · —" because it showed
 * country · visa · purpose and registry-era payloads stored all three as "".
 * It now names the applicant, the visa and the destination, and drops any
 * part it does not have instead of printing a dash.
 */
const f = (key: string, value: string) => ({ key, label: key, value })

describe('prefillHeaderParts', () => {
  it('shows applicant name · visa · country', () => {
    expect(
      prefillHeaderParts(
        {
          visaType: 'Visitor visa (temporary resident visa)',
          countryCode: 'CA',
          fields: [f('full_name', 'MUZAFFAR AHMAD')],
        },
        'en',
      ),
    ).toEqual(['MUZAFFAR AHMAD', 'Visitor visa (temporary resident visa)', 'Canada'])
  })

  it('builds the name from given + family name when there is no full name', () => {
    expect(
      prefillHeaderParts(
        { visaType: '', countryCode: '', fields: [f('given_name', 'Amira'), f('family_name', 'Haddad')] },
        'en',
      ),
    ).toEqual(['Amira Haddad'])
  })

  it('falls back to the visa_type field when the payload header is empty', () => {
    expect(
      prefillHeaderParts(
        { visaType: '', countryCode: '', fields: [f('visa_type', 'TRV'), f('application_country', 'Canada')] },
        'en',
      ),
    ).toEqual(['TRV', 'Canada'])
  })

  it('never emits empty parts', () => {
    expect(prefillHeaderParts({ visaType: '', countryCode: '', fields: [] }, 'en')).toEqual([])
  })
})
