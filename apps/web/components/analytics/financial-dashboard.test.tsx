import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('@/i18n/navigation', () => ({ Link: (p: any) => <a {...p} /> }))
import { FinancialDashboard } from './financial-dashboard'

const mk = (total: number, unit = 'cents') => ({
  metric: 'x',
  unit,
  total,
  series: [{ bucket: 'a', value: total }],
  meta: { computedAt: 'x', tier: 'rollup' },
})
const props = {
  mrr: mk(14700),
  revenue: mk(34900),
  churn: mk(5, 'count'),
  margin: mk(22900),
  ltv: mk(100000),
  query: { from: '2026-07-01', to: '2026-07-31', grain: 'month', metric: 'mrr_trend' },
  labels: { mrr: 'MRR', revenue: 'Revenue', churn: 'Churn', margin: 'Margin', ltv: 'LTV' },
} as any

describe('FinancialDashboard', () => {
  it('renders MRR panel + margin tile', () => {
    render(<FinancialDashboard {...props} />)
    expect(screen.getByText('MRR')).toBeTruthy()
    expect(screen.getByText('$229.00')).toBeTruthy()
  })
})
