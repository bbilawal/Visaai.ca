import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('@/i18n/navigation', () => ({ Link: (p: any) => <a {...p} /> }))
import { ConsultantDashboard } from './consultant-dashboard'

const takeRate = { metric: 'take_rate', unit: 'ratio', total: 0.2, series: [], meta: { computedAt: 'x', tier: 'derived' } }
const payout = { metric: 'consultant_payout', unit: 'cents', total: 80000, series: [{ bucket: 'a', value: 80000 }], meta: { computedAt: 'x', tier: 'rollup' } }
const leaderboard = {
  metric: 'consultant_leaderboard',
  unit: 'cents',
  total: 14000,
  series: [],
  byDimension: [
    { key: 'c_2', value: 9000 },
    { key: 'c_1', value: 5000 },
  ],
  meta: { computedAt: 'x', tier: 'rollup' },
}

describe('ConsultantDashboard', () => {
  it('renders take-rate % and a leaderboard bar per consultant', () => {
    const { container } = render(
      <ConsultantDashboard
        takeRate={takeRate as any}
        payout={payout as any}
        leaderboard={leaderboard as any}
        labels={{ takeRate: 'Take-rate', payout: 'Payout', leaderboard: 'Leaderboard', cor1: 'commission rules' }}
        query={{ from: 'a', to: 'b', grain: 'month' }}
      />,
    )
    expect(screen.getByText('20.0%')).toBeTruthy()
    expect(container.querySelectorAll('rect').length).toBe(2)
  })
})
