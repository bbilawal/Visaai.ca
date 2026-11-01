import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } }),
}))
import { AlertsList } from './alerts-list'

describe('AlertsList', () => {
  it('renders a rule row with its state badge', () => {
    render(
      <AlertsList
        initial={[
          {
            id: 'a1',
            name: 'MRR floor',
            metricKey: 'financial',
            metric: 'mrr_trend',
            query: {},
            conditions: [],
            combine: 'all',
            recipients: [],
            notifyUserIds: [],
            enabled: true,
            state: 'breached',
            lastValue: 84000,
          },
        ]}
        catalog={[{ key: 'financial', supportedFilters: [] }]}
      />,
    )
    expect(screen.getByText('MRR floor')).toBeTruthy()
    expect(screen.getByText(/breached/i)).toBeTruthy()
  })
})
