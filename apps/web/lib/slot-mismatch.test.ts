import { describe, expect, it } from 'vitest'
import { slotMismatchOf } from './slot-mismatch'

describe('slotMismatchOf', () => {
  it('reads the mismatch the pipeline stored on the identity row', () => {
    const m = slotMismatchOf([
      { verification_type: 'expiry', details_json: {} },
      {
        verification_type: 'identity',
        details_json: {
          slot_mismatch: {
            expected: 'previous_travel_evidence',
            detected: 'passport',
            message: 'This looks like a passport bio page.',
          },
        },
      },
    ])
    expect(m?.detected).toBe('passport')
    expect(m?.message).toMatch(/passport bio page/)
  })

  it('is null when the document fits its slot', () => {
    expect(slotMismatchOf([{ verification_type: 'identity', details_json: {} }])).toBeNull()
    expect(slotMismatchOf([{ verification_type: 'identity', details_json: null }])).toBeNull()
    expect(slotMismatchOf([])).toBeNull()
  })
})
