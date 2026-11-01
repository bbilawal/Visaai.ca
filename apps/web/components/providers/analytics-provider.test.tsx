import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

const { startSession, page, identify, getSession } = vi.hoisted(() => ({
  startSession: vi.fn(),
  page: vi.fn(),
  identify: vi.fn(),
  getSession: vi.fn(),
}))
vi.mock('@/lib/analytics/client', () => ({ analytics: { startSession, page, identify } }))
vi.mock('@/lib/supabase/client', () => ({ getSession }))
let pathname = '/en/dashboard'
vi.mock('@/i18n/navigation', () => ({ usePathname: () => pathname }))
let me: any = null
vi.mock('@/lib/auth/use-auth-user', () => ({ useAuthUser: () => ({ me, appRole: null, loading: false }) }))

import { AnalyticsProvider } from './analytics-provider'

const withSession = (access_token: string | undefined) =>
  getSession.mockResolvedValue({ data: { session: access_token ? { access_token } : null } })

describe('AnalyticsProvider', () => {
  beforeEach(() => {
    startSession.mockClear()
    page.mockClear()
    identify.mockClear()
    getSession.mockReset()
    withSession('tok-1')
    me = null
    pathname = '/en/dashboard'
  })

  it('starts a session on mount and tracks the initial page', () => {
    render(<AnalyticsProvider />)
    expect(startSession).toHaveBeenCalledTimes(1)
    expect(page).toHaveBeenCalledWith('/en/dashboard', undefined)
  })

  it('tracks a new page on pathname change', () => {
    const { rerender } = render(<AnalyticsProvider />)
    page.mockClear()
    pathname = '/en/applications'
    rerender(<AnalyticsProvider />)
    expect(page).toHaveBeenCalledWith('/en/applications', undefined)
  })

  /**
   * The regression that mattered. `/analytics/collect` attributes an event by
   * reading the verified JWT, so an event sent without a token is stored with
   * user_id NULL forever. This provider used to pass none, which pushed every
   * event onto sendBeacon — a transport that cannot set headers.
   *
   * Production recorded the consequence precisely: 788 page.viewed, 303
   * session.started and 142 user.identified events, every one unattributed,
   * and an empty analytics_identity_map.
   *
   * The previous version of this test asserted `identify('u1')` — it encoded
   * the bug and passed throughout.
   */
  it('passes the access token when identifying, so the event can be attributed', async () => {
    me = { id: 'u1' }
    render(<AnalyticsProvider />)
    await waitFor(() => expect(identify).toHaveBeenCalledWith('u1', 'tok-1'))
  })

  it('re-fires the page view with a token once auth resolves', async () => {
    // Otherwise the first view after sign-in stays stranded on the anonymous
    // id, which is the view that starts an attributed journey.
    me = { id: 'u1' }
    render(<AnalyticsProvider />)
    await waitFor(() =>
      expect(page).toHaveBeenCalledWith('/en/dashboard', 'tok-1'),
    )
  })

  it('does not identify an anonymous visitor', () => {
    me = null
    render(<AnalyticsProvider />)
    expect(identify).not.toHaveBeenCalled()
  })

  it('does not request a session for an anonymous visitor', () => {
    // Asking would mint an anonymous Supabase identity as a side effect of
    // loading analytics, which is not analytics' decision to make.
    me = null
    render(<AnalyticsProvider />)
    expect(getSession).not.toHaveBeenCalled()
  })

  it('never identifies without a token, even if the session read fails', async () => {
    // An unattributed event is a worse metric; a thrown provider is a worse
    // page. It must degrade to the former.
    me = { id: 'u1' }
    getSession.mockRejectedValue(new Error('network'))
    render(<AnalyticsProvider />)
    await waitFor(() => expect(page).toHaveBeenCalled())
    expect(identify).not.toHaveBeenCalled()
  })

  it('identifies only once for the same user', async () => {
    me = { id: 'u1' }
    const { rerender } = render(<AnalyticsProvider />)
    await waitFor(() => expect(identify).toHaveBeenCalledTimes(1))
    rerender(<AnalyticsProvider />)
    expect(identify).toHaveBeenCalledTimes(1)
  })
})
