import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AlertStateBadge } from './alert-state-badge'

describe('AlertStateBadge', () => {
  it('shows breached', () => {
    render(<AlertStateBadge state="breached" />)
    expect(screen.getByText(/breached/i)).toBeTruthy()
  })
  it('shows ok', () => {
    render(<AlertStateBadge state="ok" />)
    expect(screen.getByText(/ok/i)).toBeTruthy()
  })
})
