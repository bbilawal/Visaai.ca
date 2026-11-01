import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MetricPanel } from './metric-panel'

describe('MetricPanel', () => {
  it('renders the error slot for {error}', () => {
    render(
      <MetricPanel title="MRR" result={{ error: 'boom' }}>
        {() => <div>chart</div>}
      </MetricPanel>,
    )
    expect(screen.getByText(/boom/)).toBeTruthy()
    expect(screen.queryByText('chart')).toBeNull()
  })
  it('renders children for a valid result', () => {
    const r = {
      metric: 'mrr',
      unit: 'cents' as const,
      total: 1,
      series: [{ bucket: 'a', value: 1 }],
      meta: { computedAt: 'x', tier: 'live' as const },
    }
    render(
      <MetricPanel title="MRR" result={r}>
        {() => <div>chart</div>}
      </MetricPanel>,
    )
    expect(screen.getByText('chart')).toBeTruthy()
  })
})
