import { describe, it, expect } from 'vitest'
import { ApiError } from './client'
import { consultantActionError, NOT_ASSIGNEE_MESSAGE } from './consultant-action-error'

describe('consultantActionError', () => {
  it('turns a 403 not-assignee into what to do about it', () => {
    const err = new ApiError(
      403,
      'POST /applications/a/consultant/approve -> 403',
      'consultant 7c1e… is not the active assignee',
    )
    expect(consultantActionError(err, 'Approve failed')).toBe(NOT_ASSIGNEE_MESSAGE)
  })

  it("shows the server's reason for a 409 lock gate and a 503", () => {
    const lock = new ApiError(409, 'POST /x -> 409', 'Lock the pre-submission review first.')
    const down = new ApiError(503, 'POST /x -> 503', 'Application approval is unavailable.')
    expect(consultantActionError(lock, 'Approve failed')).toBe('Lock the pre-submission review first.')
    expect(consultantActionError(down, 'Approve failed')).toBe('Application approval is unavailable.')
  })

  it('keeps other 403 reasons as the server sent them', () => {
    const err = new ApiError(403, 'POST /x -> 403', 'Forbidden resource')
    expect(consultantActionError(err, 'Approve failed')).toBe('Forbidden resource')
  })

  it('falls back with the status when the server sent no reason', () => {
    const err = new ApiError(502, 'POST /x -> 502')
    expect(consultantActionError(err, 'Approve failed')).toBe('Approve failed (error 502)')
  })

  it('keeps a plain Error message, else the fallback', () => {
    expect(consultantActionError(new Error('Session expired'), 'Approve failed')).toBe('Session expired')
    expect(consultantActionError('boom', 'Approve failed')).toBe('Approve failed')
  })
})
