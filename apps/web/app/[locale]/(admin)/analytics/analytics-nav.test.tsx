import type * as React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('@/i18n/navigation', () => ({
  Link: (p: React.ComponentProps<'a'>) => <a {...p} />,
  // The nav derives the page's <h1> from the active route (WEB-011).
  usePathname: () => '/analytics/executive',
}))
import { AnalyticsNav } from '@/components/analytics/analytics-nav'

describe('AnalyticsNav', () => {
  it('renders a tab per dashboard', () => {
    render(
      <AnalyticsNav
        labels={{
          executive: 'Executive',
          financial: 'Financial',
          visa: 'Visa',
          ai: 'AI',
          consultant: 'Consultant',
          journey: 'Journey',
          reports: 'Reports',
        }}
      />,
    )
    // Two nodes now match 'Executive': the nav link and the sr-only <h1>.
    expect(screen.getAllByText('Executive').length).toBeGreaterThan(0)
    expect(screen.getByText('Reports')).toBeTruthy()
  })

  it('gives the active dashboard a document title', () => {
    // These pages rendered no heading of any level before WEB-011, so a screen
    // reader announced a page with no title.
    render(<AnalyticsNav labels={{ executive: 'Executive' }} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Executive')
  })
})
