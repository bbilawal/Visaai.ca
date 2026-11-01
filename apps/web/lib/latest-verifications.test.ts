import { describe, expect, it } from 'vitest'
import { latestVerifications } from './latest-verifications'

describe('latestVerifications', () => {
  it('keeps one row per verification type — the newest', () => {
    const rows = [
      { id: 'a', verification_type: 'identity', result: 'fail', verified_at: '2026-10-14T10:00:00Z' },
      { id: 'b', verification_type: 'identity', result: 'fail', verified_at: '2026-10-14T10:00:05Z' },
      { id: 'c', verification_type: 'expiry', result: 'pass', verified_at: '2026-10-14T10:00:01Z' },
      { id: 'd', verification_type: 'identity', result: 'pass', verified_at: '2026-10-14T10:00:09Z' },
    ]
    expect(latestVerifications(rows).map(r => r.id)).toEqual(['d', 'c'])
  })

  it('tolerates rows without a timestamp', () => {
    const rows = [
      { id: 'a', verification_type: 'identity', result: 'fail' },
      { id: 'b', verification_type: 'identity', result: 'pass' },
    ]
    expect(latestVerifications(rows)).toHaveLength(1)
  })
})
