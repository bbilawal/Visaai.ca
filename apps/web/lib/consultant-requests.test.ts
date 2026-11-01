import { describe, expect, it } from 'vitest'
import { documentsCompletion } from '@visaai/types'
import { openRequestIn, requestOf, withConsultantRequests, type ConsultantDocumentReview } from './consultant-requests'
import { slotIsVerified } from './required-docs'

/**
 * Live 2026-10-20: the consultant marked the passport "Needs re-upload"; the
 * applicant's vault still read Verified and counted it in "N of M verified".
 */
const review = (over: Partial<ConsultantDocumentReview> = {}): ConsultantDocumentReview => ({
  decision: 'needs_reupload',
  note: 'The photo page is cut off',
  decided_at: '2026-10-20T10:00:00Z',
  open: true,
  ...over,
})

const checklist = [
  { id: 'slot-pp', label: 'Passport', status: 'verified', required: true, meta: null },
  { id: 'slot-bank', label: 'Bank statement', status: 'verified', required: true, meta: null },
]

describe('consultant requests on the vault', () => {
  it('requestOf: only re-upload requests and rejections', () => {
    expect(requestOf({ consultant_review: review() })?.decision).toBe('needs_reupload')
    expect(requestOf({ consultant_review: review({ decision: 'rejected' }) })?.decision).toBe('rejected')
    expect(requestOf({ consultant_review: review({ decision: 'approved', note: null }) })).toBeNull()
    expect(requestOf({ consultant_review: null })).toBeNull()
    expect(requestOf({})).toBeNull()
  })

  it('an open request un-verifies its slot and drops it from the count', () => {
    const docs = [
      { id: 'd1', checklist_item_id: 'slot-pp', consultant_review: review() },
      { id: 'd2', checklist_item_id: 'slot-bank', consultant_review: null },
    ]
    expect(documentsCompletion(checklist)).toMatchObject({ done: 2, total: 2 })
    const view = withConsultantRequests(checklist, docs)
    expect(view.find(i => i.id === 'slot-pp')?.status).toBe('missing')
    expect(view.find(i => i.id === 'slot-bank')?.status).toBe('verified')
    expect(documentsCompletion(view)).toMatchObject({ done: 1, total: 2, complete: false })
    expect(slotIsVerified(view[0], true)).toBe(false)
  })

  it('a closed request (newer upload in the slot) leaves the slot alone', () => {
    const docs = [
      { id: 'old', checklist_item_id: 'slot-pp', consultant_review: review({ open: false }) },
      { id: 'new', checklist_item_id: 'slot-pp', consultant_review: null },
    ]
    expect(withConsultantRequests(checklist, docs)).toBe(checklist)
    expect(openRequestIn(docs)).toBeNull()
  })

  it('a rejection blocks the slot too; a waived slot stays waived', () => {
    const items = [{ ...checklist[0], status: 'waived' }, checklist[1]]
    const docs = [
      { id: 'd1', checklist_item_id: 'slot-pp', consultant_review: review({ decision: 'rejected' }) },
      { id: 'd2', checklist_item_id: 'slot-bank', consultant_review: review({ decision: 'rejected' }) },
    ]
    const view = withConsultantRequests(items, docs)
    expect(view[0].status).toBe('waived')
    expect(view[1].status).toBe('missing')
  })

  it('openRequestIn picks the most recent open request in a slot', () => {
    const docs = [
      { id: 'a', checklist_item_id: 's', consultant_review: review({ note: 'older', decided_at: '2026-10-19T00:00:00Z' }) },
      { id: 'b', checklist_item_id: 's', consultant_review: review({ note: 'newer', decided_at: '2026-10-20T00:00:00Z' }) },
    ]
    expect(openRequestIn(docs)?.note).toBe('newer')
  })
})
