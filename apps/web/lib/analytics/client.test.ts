import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('analytics.identify', () => {
  beforeEach(() => vi.resetModules()) // fresh module -> resets the identifiedUserId guard

  it('fires user.identified once per user, dedupes repeats, re-fires on a new user', async () => {
    const { analytics } = await import('./client')
    const track = vi.spyOn(analytics, 'track').mockImplementation(() => {})
    analytics.identify('u1')
    analytics.identify('u1') // dedup — no second fire
    analytics.identify('u2') // different user — fires
    const identifies = track.mock.calls.filter((c) => c[0] === 'user.identified')
    expect(identifies).toHaveLength(2)
    expect(track).toHaveBeenCalledWith('user.identified', {}, undefined)
  })
})
