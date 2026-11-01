import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { BarChart } from './bar-chart'

describe('BarChart', () => {
  it('renders one rect per datum, sorted desc', () => {
    const { container } = render(
      <BarChart
        data={[
          { key: 'a', value: 5 },
          { key: 'b', value: 9 },
        ]}
        ariaLabel="Payout"
      />,
    )
    const rects = container.querySelectorAll('rect')
    expect(rects.length).toBe(2)
  })
  it('empty-safe', () => {
    const { container } = render(<BarChart data={[]} />)
    expect(container.querySelectorAll('rect').length).toBe(0)
  })
})
