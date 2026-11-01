import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('@/i18n/navigation', () => ({ Link: (p: any) => <a {...p} /> }))
import { ExecutiveDashboard } from './executive-dashboard'

const summary = {
  financial: { metric: 'mrr', unit: 'cents', total: 14700, series: [], meta: { computedAt: 'x', tier: 'live' } },
  growth: { error: 'unavailable' },
} as any

describe('ExecutiveDashboard', () => {
  it('renders a tile for a metric and an unavailable card for an error slot', () => {
    render(<ExecutiveDashboard summary={summary} labels={{ financial: 'MRR', growth: 'DAU' }} />)
    expect(screen.getByText('$147.00')).toBeTruthy()
    expect(screen.getByText(/unavailable/i)).toBeTruthy()
  })
})
