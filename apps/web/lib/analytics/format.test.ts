import { describe, it, expect } from 'vitest'
import { formatMetricValue } from './format'

describe('formatMetricValue', () => {
  it('cents -> currency', () => {
    expect(formatMetricValue(14700, 'cents', 'en-US')).toBe('$147.00')
  })
  it('ratio -> percent', () => {
    expect(formatMetricValue(0.052, 'ratio', 'en-US')).toBe('5.2%')
  })
  it('count -> grouped integer', () => {
    expect(formatMetricValue(1250, 'count', 'en-US')).toBe('1,250')
  })
})
