import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AlertForm } from './alert-form'

describe('AlertForm', () => {
  it('emits a rule with one total condition', () => {
    const onSubmit = vi.fn()
    render(<AlertForm catalog={[{ key: 'financial', supportedFilters: [] }]} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'MRR floor' } })
    fireEvent.change(screen.getByLabelText(/^value$/i), { target: { value: '100000' } })
    fireEvent.click(screen.getByRole('button', { name: /save alert/i }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'MRR floor',
        metricKey: 'financial',
        conditions: [expect.objectContaining({ op: 'lt', value: 100000, target: { kind: 'total' } })],
      }),
    )
  })
})
