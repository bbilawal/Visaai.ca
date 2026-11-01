import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('./client', () => ({ apiFetch }))

import { startPreflight } from './preflight-client'

const REVIEW = {
  id: '6b1f8c1e-3c7a-4f55-9d0e-2a2b9c0f1a11',
  status: 'in_progress',
  final_approval: false,
  locked_diff_hash: null,
}

describe('startPreflight', () => {
  beforeEach(() => {
    apiFetch.mockReset()
  })

  // POST /start answers { reviewId, status, diff } — not a review row. The
  // panel used `review.id` from it, which was undefined, so every check and
  // the lock posted to /reviews/undefined/... and 500ed.
  it('resolves to the full review row so callers get review.id', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path.endsWith('/start'))
        return Promise.resolve({ reviewId: REVIEW.id, status: REVIEW.status, diff: [] })
      if (path.endsWith('/active')) return Promise.resolve(REVIEW)
      return Promise.reject(new Error(`unexpected ${path}`))
    })

    const review = await startPreflight('tok', 'app-1', [])

    expect(review.id).toBe(REVIEW.id)
    expect(apiFetch).toHaveBeenCalledWith(
      '/applications/app-1/preflight/start',
      'tok',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('throws when the started review cannot be read back', async () => {
    apiFetch.mockImplementation((path: string) =>
      path.endsWith('/start')
        ? Promise.resolve({ reviewId: REVIEW.id, status: 'in_progress', diff: [] })
        : Promise.resolve(null),
    )

    await expect(startPreflight('tok', 'app-1', [])).rejects.toThrow()
  })
})
