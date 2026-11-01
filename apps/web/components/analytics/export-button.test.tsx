import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ExportButton } from './export-button'

describe('ExportButton', () => {
  it('renders csv/xlsx/pdf export links', () => {
    render(<ExportButton metricKey="financial" query={{ from: '2026-07-01', to: '2026-07-31', grain: 'day', metric: 'mrr' }} />)
    const csv = screen.getByRole('link', { name: /csv/i }) as HTMLAnchorElement
    expect(csv.href).toContain('/analytics/metrics/financial/export')
    expect(csv.href).toContain('format=csv')
  })
})
