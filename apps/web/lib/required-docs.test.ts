import { describe, it, expect } from 'vitest'
import { blockingDocuments, isOptionalItem, docsGateItemsText, nextUploadItem, slotIsVerified } from './required-docs'

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

/**
 * Super visa, prod app 61f16bb5 (2026-10-16). "Generate my forms" was blocked
 * by "The invitation letter must state the family-size list…" (a content rule
 * stored as a slot) and by the medical exam (IRCC lets a super visa applicant
 * wait for instructions after applying). Pinned on the CORRECTED checklist the
 * registry fix produces.
 */
describe('form-generation gate — corrected super visa checklist', () => {
  const sv = (document_type: string, over: Record<string, unknown> = {}) =>
    item({ id: document_type, document_type, label: document_type, ...over })
  const checklist = [
    sv('passport_copy', { status: 'verified' }),
    sv('medical_insurance', { status: 'uploaded' }),
    sv('proof_of_medical_exam', { required: false }),
    sv('host_letter_of_invitation', { status: 'verified', meta: { kind: 'document', owner: 'sponsor' } }),
    sv('proof_of_host_status', { status: 'verified', meta: { kind: 'document', owner: 'sponsor' } }),
    sv('proof_of_relationship', { status: 'verified' }),
    sv('income_proof_option_one', { status: 'uploaded', meta: { kind: 'document', owner: 'sponsor' } }),
    sv('applicant_income_must_continue', { required: false }),
    sv('form_imm_5257', { meta: { kind: 'form' } }),
  ]

  it('does not block once every required document is in, with the IME still to come', () => {
    expect(blockingDocuments(checklist)).toEqual([])
  })

  it('names only real required documents when something is missing', () => {
    const missing = blockingDocuments(
      checklist.map(i => ((i as { id: string }).id === 'medical_insurance' ? { ...(i as object), status: 'missing' } : i)) as never[],
    )
    expect(missing.map((i: { id: string }) => i.id)).toEqual(['medical_insurance'])
  })
})

describe('nextUploadItem', () => {
  it('skips a slot already uploaded and under review', () => {
    const next = nextUploadItem([
      item({ id: 'letter', status: 'uploaded' }),
      item({ id: 'exam', required: false }),
      item({ id: 'ins' }),
    ])
    expect(next?.id).toBe('ins')
  })

  it('is null when nothing required is left to upload', () => {
    expect(nextUploadItem([item({ status: 'uploaded' }), item({ meta: { kind: 'form' } })])).toBeNull()
  })
})

describe('slotIsVerified', () => {
  // The slot badge said "Verified" off the OCR job while the checklist row
  // (what the counter counts) said "uploaded": "2 of 6 verified" under a page
  // of Verified badges.
  it('follows the checklist row for a real slot', () => {
    expect(slotIsVerified(item({ id: 'a', status: 'uploaded' }), true)).toBe(false)
    expect(slotIsVerified(item({ id: 'a', status: 'verified' }), false)).toBe(true)
    expect(slotIsVerified(item({ id: 'a', status: 'waived' }), false)).toBe(true)
  })

  it('follows the files for the catch-all slot, which has no row', () => {
    expect(slotIsVerified(item({ id: 'other', status: 'missing' }), true)).toBe(true)
  })
})
