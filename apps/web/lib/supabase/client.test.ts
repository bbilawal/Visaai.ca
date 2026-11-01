/**
 * A Supabase auth request that never settles must not wedge every later
 * getSession() in the tab.
 *
 * Seen in production 2026-10-13 on /submission/[applicationId]: the readback
 * gate sat on "Checking the pre-submission review…" indefinitely, and so did
 * every other client getSession() consumer on that load (feature flags, stage
 * progress, notifications, preflight) — none of their API requests were ever
 * sent, and nothing was logged.
 *
 * The mechanism: supabase-js holds its auth lock until every pending auth
 * operation has drained, our inMemoryLock ignores acquireTimeout, and the
 * client's fetch had no timeout. A token refresh that never answers therefore
 * holds the lock forever, and every getSession() queues behind it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SUPABASE_URL = 'https://test.supabase.co'
const STORAGE_KEY = 'sb-test-auth-token'

function seedExpiredSession() {
  const now = Math.floor(Date.now() / 1000)
  const session = {
    access_token: 'expired-access-token',
    refresh_token: 'refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    // Expired an hour ago, so the client refreshes during initialisation.
    expires_at: now - 3600,
    user: { id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated' },
  }
  const encoded = Buffer.from(JSON.stringify(session)).toString('base64url')
  document.cookie = `${STORAGE_KEY}=base64-${encoded}; path=/`
}

/**
 * fetch whose token endpoint hangs until `networkUp()` is called, honouring its
 * abort signal like real fetch. Other auth endpoints answer immediately.
 */
function tokenFetch() {
  let up = false
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.includes('/auth/v1/token')) {
      return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }
    if (up) {
      const now = Math.floor(Date.now() / 1000)
      return Promise.resolve(new Response(JSON.stringify({
        access_token: 'fresh-access-token',
        refresh_token: 'fresh-refresh-token',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: now + 3600,
        user: { id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      if (signal?.aborted) return reject(signal.reason)
      signal?.addEventListener('abort', () => reject(signal.reason))
    })
  })
  return { fetchMock, networkUp: () => { up = true } }
}

describe('getSession when an auth request never settles', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
    seedExpiredSession()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    document.cookie = `${STORAGE_KEY}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`
  })

  // One scenario, not two: @supabase/ssr keeps a single browser client per
  // module, and vi.resetModules() does not reset node_modules, so a second test
  // would inherit the first one's client.
  it('rejects within GET_SESSION_TIMEOUT_MS, then recovers once the auth server answers', async () => {
    const { fetchMock, networkUp } = tokenFetch()
    vi.stubGlobal('fetch', fetchMock)
    const { getSession, GET_SESSION_TIMEOUT_MS } = await import('./client')

    let outcome: 'pending' | 'resolved' | 'rejected' = 'pending'
    const first = getSession().then(
      () => { outcome = 'resolved' },
      () => { outcome = 'rejected' },
    )
    await vi.advanceTimersByTimeAsync(GET_SESSION_TIMEOUT_MS)
    await first
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/auth/v1/token'))).toBe(true)
    expect(outcome).toBe('rejected')

    // Without a bound on the hung refresh request, supabase-js would still be
    // waiting on it here and no later call could ever succeed.
    networkUp()
    await vi.advanceTimersByTimeAsync(60_000)

    const second = getSession()
    await vi.advanceTimersByTimeAsync(GET_SESSION_TIMEOUT_MS)
    const { data } = await second
    expect(data.session?.access_token).toBe('fresh-access-token')
  })
})
