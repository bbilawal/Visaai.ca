/**
 * BUG-002 regression: the public funnel must not open an authenticated SSE
 * stream with a guest (anonymous) identity. JwtGuard is deliberately fail-closed
 * for anonymous callers, so every attempt 403s and openSseStream's reconnect
 * backoff turns that into an endless retry loop on a page that never needed the
 * stream at all.
 *
 * Run: pnpm --filter web test:unit
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const getSession = vi.fn()
// Only the session lookup is faked — isGuestSession stays the real
// implementation so this exercises the shipped guest predicate.
vi.mock('@/lib/supabase/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./supabase/client.ts')>()),
  getSession: (...args: unknown[]) => getSession(...args),
}))

const { openSseStream } = await import('./sse-stream.ts')

function sessionFor(isAnonymous: boolean) {
  return {
    data: {
      session: {
        access_token: 'token-abc',
        user: { id: 'u1', is_anonymous: isAnonymous },
      },
    },
  }
}

/** Lets queued microtasks (the async connect()) run to completion. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  fetchMock = vi.fn().mockRejectedValue(new Error('stream 403'))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  getSession.mockReset()
})

describe('openSseStream', () => {
  test('does not connect at all for a guest (anonymous) session', async () => {
    getSession.mockResolvedValue(sessionFor(true))

    const close = openSseStream('/messaging/stream', () => {})
    await flush()

    expect(fetchMock).not.toHaveBeenCalled()
    close()
  })

  test('a guest session schedules no reconnect', async () => {
    getSession.mockResolvedValue(sessionFor(true))

    const close = openSseStream('/messaging/stream', () => {})
    await flush()
    await vi.advanceTimersByTimeAsync(30_000)

    expect(fetchMock).not.toHaveBeenCalled()
    close()
  })

  test('still connects for a permanent session', async () => {
    getSession.mockResolvedValue(sessionFor(false))

    const close = openSseStream('/messaging/stream', () => {})
    await flush()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain('/messaging/stream')
    close()
  })

  test('no session at all still connects nothing', async () => {
    getSession.mockResolvedValue({ data: { session: null } })

    const close = openSseStream('/messaging/stream', () => {})
    await flush()

    expect(fetchMock).not.toHaveBeenCalled()
    close()
  })
})
