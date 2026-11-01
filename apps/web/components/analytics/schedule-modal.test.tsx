import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ScheduleModal } from './schedule-modal'

describe('ScheduleModal', () => {
  it('submits a cron built from the preset', () => {
    const onSubmit = vi.fn()
    render(<ScheduleModal onSubmit={onSubmit} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/time/i), { target: { value: '08:00' } })
    fireEvent.change(screen.getByLabelText(/recipients/i), { target: { value: 'a@b.c' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ cron: '0 8 * * 1', recipients: ['a@b.c'] }))
  })
})
