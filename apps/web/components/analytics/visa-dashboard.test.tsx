import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VisaDashboard } from './visa-dashboard'

const funnel = (name: string) => ({
  metric: `${name}_funnel`,
  unit: 'count',
  total: 70,
  series: [],
  meta: { computedAt: 'x', tier: 'rollup' },
  extra: {
    overallRate: 0.7,
    steps: [
      { step: 'submitted', entered: 100, converted: 100, rate: 1 },
      { step: 'approved', entered: 100, converted: 70, rate: 0.7 },
    ],
  },
})

describe('VisaDashboard', () => {
  it('renders both funnels', () => {
    render(
      <VisaDashboard
        approval={funnel('approval') as any}
        application={funnel('application') as any}
        labels={{ approval: 'Approval', application: 'Application' }}
      />,
    )
    expect(screen.getByText('Approval')).toBeTruthy()
    expect(screen.getAllByText('approved').length).toBeGreaterThan(0)
  })
})
