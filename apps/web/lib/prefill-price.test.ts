import { describe, expect, it } from 'vitest'
import {
  CA_ETA_VISAAI_ID,
  PREFILL_PRICE_CENTS_DEFAULT,
  formatPrefillPrice,
  prefillPriceCents,
} from '@visaai/types'

/** The one-time form fee table the API charges from and the web shows. */
describe('prefill (form fee) price', () => {
  it('the Canada eTA is $10', () => {
    expect(prefillPriceCents(CA_ETA_VISAAI_ID)).toBe(1000)
    expect(formatPrefillPrice(CA_ETA_VISAAI_ID)).toBe('$10')
  })

  it('every other visa type, and an unknown one, is $29', () => {
    expect(PREFILL_PRICE_CENTS_DEFAULT).toBe(2900)
    for (const id of ['ca-visitor-visa-trv', 'toString', '', null, undefined]) {
      expect(prefillPriceCents(id)).toBe(2900)
      expect(formatPrefillPrice(id)).toBe('$29')
    }
  })
})
