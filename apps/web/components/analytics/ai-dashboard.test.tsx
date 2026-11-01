import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('@/i18n/navigation', () => ({ Link: (p: any) => <a {...p} /> }))
import { AiDashboard } from './ai-dashboard'

const cost = {
  metric: 'ai_cost_per_application',
  unit: 'cents',
  total: 550,
  series: [
    { bucket: 'a', value: 250 },
    { bucket: 'b', value: 300 },
  ],
  meta: { computedAt: 'x', tier: 'live' },
}

describe('AiDashboard', () => {
  it('renders the AI cost panel with total', () => {
    render(<AiDashboard cost={cost as any} labels={{ cost: 'AI cost / application' }} query={{ from: 'a', to: 'b', grain: 'day' }} />)
    expect(screen.getAllByText('AI cost / application').length).toBeGreaterThan(0)
    expect(screen.getByText('$5.50')).toBeTruthy()
  })
})
