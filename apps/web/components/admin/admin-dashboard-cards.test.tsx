import { describe, it, expect } from 'vitest'
import { render as rtlRender, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { AdminDashboardCards } from './admin-dashboard-cards'
import type { AdminDashboard } from '@visaai/types'

/** The cards read the active locale to group large numbers (UI-002), so they
 *  need the same intl context the app provides in app/[locale]/layout.tsx. */
const render = (ui: React.ReactNode) =>
  rtlRender(
    <NextIntlClientProvider locale="en" messages={{}}>
      {ui}
    </NextIntlClientProvider>,
  )

const labels = {
  users: 'Users', consultants: 'Consultants', inProgress: 'In progress',
  aiTokens: 'AI tokens', revenue: 'Orders', logins: 'Logins', lockouts: 'Lockouts',
  notAvailable: 'Not yet available',
}

const data: AdminDashboard = {
  range: '30d',
  users: { total: 100, newInRange: 8 },
  consultants: { total: 5 },
  applications: { inProgress: 9, byStatus: { draft: 4, ready: 3, submitted: 2, decided: 9 } },
  ai: { tokens: 1250, requestCostUsd: 1.5, billableCostUsd: 2 },
  revenue: { completedByTier: { self_service: 3 }, note: 'volume' },
  security: { logins: 40, lockouts: 2 },
  recentActivity: [],
  subscriptions: { available: false, reason: 'M3.1' },
  supportTickets: { available: false, reason: 'phase 8' },
  systemHealth: { available: true, dbReachable: true },
}

describe('AdminDashboardCards', () => {
  it('renders real metric cards with values', () => {
    render(<AdminDashboardCards data={data} labels={labels} />)
    expect(screen.getByText('Users')).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText('In progress')).toBeInTheDocument()
    expect(screen.getByText('9')).toBeInTheDocument()
    // UI-002: four digits and up are grouped for the active locale. The raw
    // "1815625" this used to print is what a production admin saw for AI tokens.
    expect(screen.getByText('1,250')).toBeInTheDocument()
    expect(screen.queryByText('1250')).not.toBeInTheDocument()
  })

  it('renders "not yet available" cards for unbuilt subsystems', () => {
    render(<AdminDashboardCards data={data} labels={labels} />)
    // subscriptions + support tickets both unavailable
    expect(screen.getAllByText('Not yet available').length).toBeGreaterThanOrEqual(2)
  })
})
