import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('@/i18n/navigation', () => ({ Link: (p: any) => <a {...p} /> }))
import { MetricTile } from './metric-tile'

const result = {
  metric: 'mrr',
  unit: 'cents' as const,
  total: 14700,
  series: [{ bucket: 'a', value: 14700 }],
  delta: { baseline: 10000, pct: 0.47 },
  meta: { computedAt: 'x', tier: 'live' as const },
}

describe('MetricTile', () => {
  it('formats the total and shows the delta', () => {
    render(<MetricTile label="MRR" result={result} />)
    expect(screen.getByText('MRR')).toBeTruthy()
    expect(screen.getByText('$147.00')).toBeTruthy()
    expect(screen.getByText(/\+47\.0%/)).toBeTruthy()
  })
})
