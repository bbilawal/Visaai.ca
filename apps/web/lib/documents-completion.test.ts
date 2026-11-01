import { describe, it, expect } from 'vitest'
import { documentsCompletion, requiredDocumentItems, isChecklistItemSatisfied } from '@visaai/types'

/**
 * This predicate gates real behaviour in three places — the server's
 * auto-generate, the documents page's Generate button, and the progress
 * stage. If they ever disagree, the button says "ready" while the server
 * refuses, so the rule lives here and is pinned here.
 */
const doc = (status: string, over: Record<string, unknown> = {}) =>
  ({ status, required: true, ...over }) as Parameters<typeof documentsCompletion>[0][number]

describe('documentsCompletion', () => {
  it('counts verified and waived as satisfied, nothing else', () => {
    expect(isChecklistItemSatisfied(doc('verified'))).toBe(true)
    expect(isChecklistItemSatisfied(doc('waived'))).toBe(true)
    expect(isChecklistItemSatisfied(doc('uploaded'))).toBe(false)
    expect(isChecklistItemSatisfied(doc('missing'))).toBe(false)
  })

  it('is complete only when every required document is satisfied', () => {
    expect(documentsCompletion([doc('verified'), doc('waived')])).toEqual({
      total: 2,
      done: 2,
      complete: true,
    })
    expect(documentsCompletion([doc('verified'), doc('uploaded')])).toMatchObject({
      done: 1,
      complete: false,
    })
  })

  it('treats an UPLOADED-but-unverified document as not done', () => {
    // The whole point of the gate: a file that has not been read yet cannot
    // prefill a form, so uploading is not finishing.
    expect(documentsCompletion([doc('uploaded')]).complete).toBe(false)
  })

  it('ignores forms — those are blank government forms we hand out, not evidence', () => {
    const items = [doc('verified'), doc('missing', { meta: { kind: 'form' } })]
    expect(documentsCompletion(items)).toMatchObject({ total: 1, complete: true })
  })

  it('ignores optional items so "strengthen your case" never blocks the flow', () => {
    const items = [doc('verified'), doc('missing', { required: false })]
    expect(documentsCompletion(items)).toMatchObject({ total: 1, complete: true })
  })

  it('an EMPTY checklist is not complete', () => {
    // Intake has not produced requirements yet. Reporting "done" here would
    // unlock a Generate button with nothing to generate from.
    expect(documentsCompletion([])).toEqual({ total: 0, done: 0, complete: false })
    expect(documentsCompletion([doc('missing', { required: false })]).complete).toBe(false)
  })

  it('requiredDocumentItems returns the gating items in order', () => {
    const a = doc('missing')
    const b = doc('verified')
    expect(requiredDocumentItems([a, doc('missing', { meta: { kind: 'form' } }), b])).toEqual([a, b])
  })
})
