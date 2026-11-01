import { describe, it, expect } from 'vitest'
import { presetToCron } from './preset-cron'

describe('presetToCron', () => {
  it('daily at 08:00', () => {
    expect(presetToCron({ freq: 'daily', time: '08:00' })).toBe('0 8 * * *')
  })
  it('weekly Monday 09:30', () => {
    expect(presetToCron({ freq: 'weekly', day: 1, time: '09:30' })).toBe('30 9 * * 1')
  })
  it('monthly on the 1st 06:00', () => {
    expect(presetToCron({ freq: 'monthly', day: 1, time: '06:00' })).toBe('0 6 1 * *')
  })
})
