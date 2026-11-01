import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { JourneyDashboard } from './journey-dashboard'

describe('JourneyDashboard', () => {
  it('shows the degraded banner when activation is stale/empty', () => {
    const activation = {
      metric: 'activation_funnel',
      unit: 'count',
      total: 0,
      series: [],
      meta: { computedAt: 'x', tier: 'rollup', stale: true },
      extra: { overallRate: 0, steps: [] },
    }
    render(
      <JourneyDashboard
        activation={activation as any}
        labels={{ activation: 'Activation', degraded: 'Waiting for event wiring' }}
      />,
    )
    expect(screen.getByText(/waiting for event wiring/i)).toBeTruthy()
  })
})
