import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { LineChart } from './line-chart'

describe('LineChart', () => {
  it('renders an SVG path for a non-empty series', () => {
    const { container } = render(
      <LineChart
        series={[
          { bucket: '2026-07-01', value: 10 },
          { bucket: '2026-07-02', value: 30 },
        ]}
        ariaLabel="MRR"
      />,
    )
    expect(container.querySelector('svg')).toBeTruthy()
    expect(container.querySelector('path')).toBeTruthy()
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toBe('MRR')
  })
  it('renders empty-safe with no points', () => {
    const { container } = render(<LineChart series={[]} />)
    expect(container.querySelector('path')).toBeNull()
  })
})
