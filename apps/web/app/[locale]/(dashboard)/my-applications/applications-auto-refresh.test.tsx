import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import { ApplicationsAutoRefresh, REFRESH_INTERVAL_MS } from './applications-auto-refresh'

/**
 * #38 (dry run 2026-10-14): after a consultant claimed the application, the
 * applicant's "My applications" kept saying "Not assigned" until a manual
 * reload. The page is server-rendered with no live channel for applicants, so
 * it re-pulls the authoritative list on return to the tab and on an interval.
 */
describe('ApplicationsAutoRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    refresh.mockClear()
  })
  afterEach(() => vi.useRealTimers())

  it('refetches on an interval while the tab is visible', () => {
    render(<ApplicationsAutoRefresh />)
    expect(refresh).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(REFRESH_INTERVAL_MS))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('refetches when the applicant returns to the tab', () => {
    render(<ApplicationsAutoRefresh />)
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does not poll a hidden tab', () => {
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    render(<ApplicationsAutoRefresh />)
    act(() => vi.advanceTimersByTime(REFRESH_INTERVAL_MS * 3))
    expect(refresh).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('stops refreshing once unmounted', () => {
    const { unmount } = render(<ApplicationsAutoRefresh />)
    unmount()
    act(() => vi.advanceTimersByTime(REFRESH_INTERVAL_MS * 2))
    window.dispatchEvent(new Event('focus'))
    expect(refresh).not.toHaveBeenCalled()
  })
})
