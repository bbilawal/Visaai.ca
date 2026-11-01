import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FunnelChart } from './funnel-chart'

describe('FunnelChart', () => {
  it('renders a row per step with its conversion %', () => {
    render(
      <FunnelChart
        steps={[
          { step: 'submitted', entered: 100, converted: 100, rate: 1 },
          { step: 'approved', entered: 100, converted: 70, rate: 0.7 },
        ]}
        ariaLabel="Approval"
      />,
    )
    expect(screen.getByText('submitted')).toBeTruthy()
    expect(screen.getByText('approved')).toBeTruthy()
    expect(screen.getByText(/70/)).toBeTruthy()
  })
})
