import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RunSnapshot } from './run-snapshot'

describe('RunSnapshot', () => {
  it('renders the snapshot total', () => {
    const result = {
      metric: 'mrr',
      unit: 'cents',
      total: 14700,
      series: [{ bucket: 'a', value: 14700 }],
      meta: { computedAt: 'x', tier: 'rollup' },
    }
    render(<RunSnapshot result={result as any} title="MRR weekly" />)
    expect(screen.getByText('MRR weekly')).toBeTruthy()
  })
  it('handles a missing snapshot', () => {
    render(<RunSnapshot result={null} title="MRR weekly" />)
    expect(screen.getByText(/no snapshot/i)).toBeTruthy()
  })
})
