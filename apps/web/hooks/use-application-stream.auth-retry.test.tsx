import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

/**
 * A socket handshake that fails on an EXPIRED token must re-handshake with a
 * fresh one.
 *
 * socket.io replays the `auth.token` bound when the socket was built, and that
 * token has a one-hour life the socket never refreshes. The handler concluded
 * "auth failures won't recover by retrying" and gave up, so an interview that
 * outlived its token could never reconnect. Production 2026-09-03:
 * `[jwt] Supabase token validation failed: ... token is expired` on the
 * gateway handshake.
 */

type Handlers = Record<string, (arg?: unknown) => void>

const sockets: Array<{ token: string | undefined; handlers: Handlers; connected: boolean }> = []
let currentToken = 'expired-token'

vi.mock('@/lib/socket', () => ({
  getIntakeSocket: (token?: string) => {
    const handlers: Handlers = {}
    const socket = {
      token,
      handlers,
      connected: false,
      on: (event: string, fn: (arg?: unknown) => void) => { handlers[event] = fn },
      emit: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      removeAllListeners: vi.fn(),
    }
    sockets.push(socket as never)
    return socket
  },
  resetIntakeSocket: () => {},
}))

vi.mock('@/lib/supabase/client', () => ({
  getSession: () =>
    Promise.resolve({ data: { session: { access_token: currentToken } } }),
}))

const { useApplicationStream } = await import('./use-application-stream')

describe('useApplicationStream — an expired socket token re-handshakes', () => {
  beforeEach(() => {
    sockets.length = 0
    currentToken = 'expired-token'
  })
  afterEach(() => vi.clearAllMocks())

  it('rebuilds the socket with a fresh token instead of surfacing the error', async () => {
    const { result } = renderHook(() =>
      useApplicationStream({ applicationId: 'app-1' }),
    )

    await waitFor(() => expect(sockets).toHaveLength(1))
    expect(sockets[0].token).toBe('expired-token')

    // The session rotates in the background, as supabase-js does.
    currentToken = 'fresh-token'
    sockets[0].handlers['connect_error']?.(new Error('Unauthorized: invalid token'))

    await waitFor(() => expect(sockets).toHaveLength(2))
    expect(sockets[1].token).toBe('fresh-token')
    // The applicant is never shown the failure that just recovered itself.
    expect(result.current.error).toBeNull()
  })

  it('gives up after one attempt so a real refusal cannot loop', async () => {
    const { result } = renderHook(() =>
      useApplicationStream({ applicationId: 'app-1' }),
    )

    await waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0].handlers['connect_error']?.(new Error('Unauthorized: invalid token'))

    await waitFor(() => expect(sockets).toHaveLength(2))
    sockets[1].handlers['connect_error']?.(new Error('Unauthorized: invalid token'))

    await waitFor(() => expect(result.current.error).toMatch(/Unauthorized/))
    expect(sockets).toHaveLength(2)
  })
})
