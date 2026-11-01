import { describe, it, expect } from 'vitest'
import { metricPath, exportUrl } from './analytics-client'

describe('analytics-client path builders', () => {
  it('metricPath encodes metric + range + single filter', () => {
    const p = metricPath('financial', {
      from: '2026-07-01',
      to: '2026-07-31',
      grain: 'day',
      metric: 'mrr',
      filters: { plan: 'pro' },
    } as any)
    expect(p).toContain('/analytics/metrics/financial?')
    expect(p).toContain('metric=mrr')
    expect(p).toContain('from=2026-07-01')
    expect(p).toContain('filters%5Bplan%5D=pro')
  })
  it('exportUrl appends format', () => {
    const u = exportUrl('financial', { from: '2026-07-01', to: '2026-07-31', grain: 'day', metric: 'mrr' } as any, 'csv')
    expect(u).toContain('/analytics/metrics/financial/export?')
    expect(u).toContain('format=csv')
  })
})
