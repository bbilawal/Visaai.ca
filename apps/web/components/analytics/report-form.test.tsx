import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReportForm } from './report-form'

describe('ReportForm', () => {
  it('submits the create payload with name + metric', () => {
    const onCreate = vi.fn()
    render(<ReportForm catalog={[{ key: 'financial', supportedFilters: [] }]} onCreate={onCreate} />)
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'MRR weekly' } })
    fireEvent.click(screen.getByRole('button', { name: /create report/i }))
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'MRR weekly', metricKey: 'financial', metric: 'mrr_trend' }))
  })
})
