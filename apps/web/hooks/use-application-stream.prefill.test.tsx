import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

/**
 * Dry run 2026-10-16: on reload the interview page showed an empty chat for
 * several seconds, until the socket's history arrived. The stored transcript
 * is now painted from the REST endpoint first; the socket history still wins.
 */

type Handlers = Record<string, (arg?: unknown) => void>
const sockets: Array<{ handlers: Handlers }> = []

vi.mock('@/lib/socket', () => ({
  getIntakeSocket: () => {
    const handlers: Handlers = {}
    const socket = {
      handlers,
      connected: true,
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
  getSession: () => Promise.resolve({ data: { session: { access_token: 'tok' } } }),
}))

process.env.NEXT_PUBLIC_API_URL = 'https://api.test'
vi.stubGlobal(
  'fetch',
  vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve([{ id: 'm1', role: 'assistant', content: 'What is your marital status?' }]),
    } as Response),
  ),
)

const { useApplicationStream } = await import('./use-application-stream')

afterEach(() => {
  sockets.length = 0
})

describe('useApplicationStream — transcript before the socket', () => {
  it('shows the stored transcript before intake:history arrives, then defers to it', async () => {
    const { result } = renderHook(() => useApplicationStream({ applicationId: 'app-1' }))
    await waitFor(() => expect(result.current.messages.map(m => m.content)).toEqual(['What is your marital status?']))
    expect(fetch).toHaveBeenCalledWith('https://api.test/intake/applications/app-1/messages', expect.anything())

    act(() =>
      sockets[0].handlers['intake:history']?.({
        messages: [
          { id: 'm1', role: 'assistant', content: 'What is your marital status?' },
          { id: 'm2', role: 'user', content: 'Married' },
        ],
      }),
    )
    expect(result.current.messages).toHaveLength(2)
  })
})
