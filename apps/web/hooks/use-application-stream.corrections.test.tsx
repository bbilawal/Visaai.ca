import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

/**
 * Dry run 2026-10-15: once the intake was complete the applicant could not
 * correct a wrong answer. Messages after completion are now corrections, and
 * a correction can remove a required answer — the server then resumes the
 * interview and says `isComplete: false`. The hook used to only ever set the
 * flag to true, so the page kept claiming "Intake complete" over an interview
 * that was asking questions again.
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
  getSession: () =>
    Promise.resolve({ data: { session: { access_token: 'tok' } } }),
}))

const { useApplicationStream } = await import('./use-application-stream')

describe('useApplicationStream — completion follows the server', () => {
  beforeEach(() => {
    sockets.length = 0
  })

  it('goes back to incomplete when a correction removes a required answer', async () => {
    const { result } = renderHook(() =>
      useApplicationStream({ applicationId: 'app-1' }),
    )
    await waitFor(() => expect(sockets).toHaveLength(1))
    const h = sockets[0].handlers

    act(() => h['intake:history']?.({ messages: [], isComplete: true }))
    expect(result.current.isComplete).toBe(true)

    act(() =>
      h['intake:message']?.({ role: 'assistant', content: 'Updated.', isComplete: true }),
    )
    expect(result.current.isComplete).toBe(true)

    act(() =>
      h['intake:message']?.({ role: 'assistant', content: 'What is…?', isComplete: false }),
    )
    expect(result.current.isComplete).toBe(false)
  })

  it('a reply without the flag (a guardrail refusal) leaves completion alone', async () => {
    const { result } = renderHook(() =>
      useApplicationStream({ applicationId: 'app-1' }),
    )
    await waitFor(() => expect(sockets).toHaveLength(1))
    const h = sockets[0].handlers

    act(() => h['intake:history']?.({ messages: [], isComplete: true }))
    act(() => h['intake:message']?.({ role: 'assistant', content: 'I can’t help with that.' }))
    expect(result.current.isComplete).toBe(true)
  })
})
