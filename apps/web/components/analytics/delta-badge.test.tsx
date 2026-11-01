import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DeltaBadge } from './delta-badge'
import { StaleBadge } from './stale-badge'

describe('DeltaBadge', () => {
  it('renders +% for a positive delta', () => {
    render(<DeltaBadge delta={{ baseline: 100, pct: 0.5 }} />)
    expect(screen.getByText(/\+50\.0%/)).toBeTruthy()
  })
  it('renders nothing when null', () => {
    const { container } = render(<DeltaBadge delta={null} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('StaleBadge', () => {
  it('shows when stale', () => {
    render(<StaleBadge stale />)
    expect(screen.getByText(/stale/i)).toBeTruthy()
  })
  it('hidden when fresh', () => {
    const { container } = render(<StaleBadge stale={false} />)
    expect(container.firstChild).toBeNull()
  })
})
