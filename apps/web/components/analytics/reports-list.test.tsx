import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } }),
}))
import { ReportsList } from './reports-list'

describe('ReportsList', () => {
  it('renders saved report rows', () => {
    render(
      <ReportsList
        initial={[{ id: 'r1', name: 'MRR weekly', metricKey: 'financial', metric: 'mrr_trend', query: {} }]}
        catalog={[{ key: 'financial', supportedFilters: [] }]}
      />,
    )
    expect(screen.getByText('MRR weekly')).toBeTruthy()
  })
})
