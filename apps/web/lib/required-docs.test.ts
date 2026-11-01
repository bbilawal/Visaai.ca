import { describe, it, expect } from 'vitest'
import { blockingDocuments, isOptionalItem, docsGateItemsText } from './required-docs'

/**
 * Dry run 2026-10-14 (app 71ad0c29): "Evidence of previous travel" — a
 * registry recommendation — blocked "Generate my forms" for an applicant who
 * has never travelled, and the button appeared to do nothing.
 */
const item = (over: Record<string, unknown> = {}) =>
  ({ id: 'i', label: 'Passport', status: 'missing', required: true, meta: { kind: 'document' }, ...over }) as never

describe('blockingDocuments', () => {
  it('blocks on a missing required document', () => {
    expect(blockingDocuments([item()])).toHaveLength(1)
  })

  it('never blocks on an optional (required=false) item, e.g. a recommendation', () => {
    expect(blockingDocuments([item({ label: 'Evidence of previous travel', required: false })])).toEqual([])
  })

  it('never blocks on forms or strengthening evidence', () => {
    expect(blockingDocuments([item({ meta: { kind: 'form' } })])).toEqual([])
    expect(blockingDocuments([item({ meta: { kind: 'document', strength: true } })])).toEqual([])
  })

  it('does not block once uploaded, verified or waived', () => {
    for (const status of ['uploaded', 'verified', 'waived']) {
      expect(blockingDocuments([item({ status })])).toEqual([])
    }
  })
})

describe('isOptionalItem', () => {
  it('is true for strengthening items and for required=false items', () => {
    expect(isOptionalItem(item({ meta: { strength: true } }))).toBe(true)
    expect(isOptionalItem(item({ required: false }))).toBe(true)
    expect(isOptionalItem(item())).toBe(false)
  })
})

describe('docsGateItemsText', () => {
  it('names the blocking documents so the reason is visible', () => {
    expect(docsGateItemsText([item({ label: 'Passport' }), item({ label: 'Bank statements' })])).toBe(
      'Passport, Bank statements',
    )
  })

  it('caps a long list', () => {
    const many = Array.from({ length: 6 }, (_, n) => item({ label: `Doc ${n}` }))
    expect(docsGateItemsText(many)).toBe('Doc 0, Doc 1, Doc 2 +3')
  })
})
