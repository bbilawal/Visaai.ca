import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FilterBar } from './filter-bar'

describe('FilterBar', () => {
  it('calls onChange with the new grain', () => {
    const onChange = vi.fn()
    render(<FilterBar value={{ from: '2026-07-01', to: '2026-07-31', grain: 'day' }} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /month/i }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ grain: 'month' }))
  })
})
