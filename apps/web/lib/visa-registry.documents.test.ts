import { describe, it, expect, vi, beforeEach } from 'vitest'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from }) }))

import { countApplicantDocuments } from './visa-registry'

/** Minimal builder matching `.from().select().eq().eq()` resolving to a result. */
function rows(result: { data: unknown[] | null; error: { message: string } | null }) {
  const builder: Record<string, unknown> = {}
  builder.select = () => builder
  builder.eq = () => builder
  builder.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve)
  return builder
}

/**
 * Two empty checklists look identical to the intake sidebar and mean opposite
 * things:
 *
 *   * no route chosen — documents genuinely will appear once one is;
 *   * a route chosen whose requirements contain NO applicant uploads.
 *
 * The second is real. The Dutch highly skilled migrant permit has fourteen
 * requirements and zero uploads: only an IND-recognised sponsor can lodge it,
 * and IND publishes no applicant-facing document list. Telling that person
 * "documents will appear here" is a promise nothing will ever keep.
 */
describe('countApplicantDocuments', () => {
  beforeEach(() => vi.clearAllMocks())

  it('counts only the kinds an applicant actually uploads', () => {
    // Same pair registry-to-framework uses to build a checklist. Conditions,
    // steps and fees are requirements, but not things you put in a folder.
    from.mockReturnValue(
      rows({
        data: [
          { kind: 'evidence' },
          { kind: 'recommended' },
          { kind: 'condition' },
          { kind: 'step' },
          { kind: 'fee' },
          { kind: 'form' },
        ],
        error: null,
      }),
    )
    return expect(countApplicantDocuments('vt-1')).resolves.toEqual({
      documents: 2,
      total: 6,
    })
  })

  it('reports zero documents for a route that has requirements but no uploads', () => {
    // The Dutch highly skilled migrant shape. This is the case the whole
    // function exists for.
    from.mockReturnValue(
      rows({
        data: [{ kind: 'condition' }, { kind: 'condition' }, { kind: 'step' }, { kind: 'fee' }],
        error: null,
      }),
    )
    return expect(countApplicantDocuments('vt-1')).resolves.toEqual({
      documents: 0,
      total: 4,
    })
  })

  it('returns null when no route has been chosen, without querying', async () => {
    // Distinct from "zero documents": the sidebar must still promise documents
    // are coming, because they are.
    await expect(countApplicantDocuments(null)).resolves.toBeNull()
    expect(from).not.toHaveBeenCalled()
  })

  it('returns null when the route has no requirements at all', () => {
    // Discovery mode / an uncovered visa type. Not the same as "no uploads".
    from.mockReturnValue(rows({ data: [], error: null }))
    return expect(countApplicantDocuments('vt-1')).resolves.toBeNull()
  })

  it('returns null on a read failure rather than claiming zero', () => {
    // A database problem must not tell someone their visa needs no documents.
    from.mockReturnValue(rows({ data: null, error: { message: 'boom' } }))
    return expect(countApplicantDocuments('vt-1')).resolves.toBeNull()
  })
})
