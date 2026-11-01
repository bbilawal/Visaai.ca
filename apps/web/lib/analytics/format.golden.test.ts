import { describe, it, expect } from 'vitest'
import { formatMetricValue } from './format'

describe('formatMetricValue golden', () => {
  it.each([
    [14700, 'cents', '$147.00'],
    [176400, 'cents', '$1,764.00'],
    [0.052, 'ratio', '5.2%'],
    [0.2, 'ratio', '20.0%'],
    [1250, 'count', '1,250'],
    [5, 'usd', '$5.00'],
  ] as const)('%d %s -> %s', (v, unit, out) => {
    expect(formatMetricValue(v, unit as any, 'en-US')).toBe(out)
  })
})
