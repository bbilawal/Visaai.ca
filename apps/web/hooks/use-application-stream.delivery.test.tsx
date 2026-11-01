import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

/**
 * An applicant message is never lost silently.
 *
 * Prod 2026-10-21 (after an API restart) and 2026-10-24 (on a fresh load while
 * the session refresh was failing; and signed in as a user with no access):
 * the applicant typed a correction, pressed Return, the input cleared — and
 * nothing. No bubble, no "Thinking…", no error, nothing reached the API.
 * `sendMessage` did `socketRef.current?.emit(...)` and forgot about it:
 *   - no socket yet (getSession still pending)  -> the emit was skipped;
 *   - a socket replaced by the auth re-handshake -> socket.io's send buffer
 *     went with it;
 *   - the next `intake:history` replaced `messages`, wiping the bubble.
 */

type Handlers = Record<string, (arg?: unknown) => void>
type FakeSocket = {
  token?: string
  handlers: Handlers
  connected: boolean
  emit: ReturnType<typeof vi.fn>
}
const sockets: FakeSocket[] = []

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

let sessionImpl: () => Promise<unknown> = () =>
  Promise.resolve({ data: { session: { access_token: 'tok' } } })
vi.mock('@/lib/supabase/client', () => ({
  getSession: () => sessionImpl(),
}))

const { useApplicationStream, mergeHistory, DELIVERY_TIMEOUT_MS, NOT_SENT_ERROR } =
  await import('./use-application-stream')

const OPENING = { id: 'a1', role: 'assistant' as const, content: 'Your intake is complete.' }
const HISTORY = { messages: [OPENING], isComplete: true, receipts: true }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Connect the socket and open the session the way the server does. */
function open(s: FakeSocket, history: object = HISTORY) {
  act(() => {
    s.connected = true
    s.handlers['connect']?.()
  })
  act(() => s.handlers['intake:history']?.(history))
}

function messageEmits(s: FakeSocket) {
  return s.emit.mock.calls.filter(c => c[0] === 'intake:message')
}
function startEmits(s: FakeSocket) {
  return s.emit.mock.calls.filter(c => c[0] === 'intake:start')
}
function lastId(s: FakeSocket): string {
  const emits = messageEmits(s)
  return (emits.at(-1)![1] as { clientMsgId: string }).clientMsgId
}

async function mounted() {
  const hook = renderHook(() => useApplicationStream({ applicationId: 'app-1' }))
  await waitFor(() => expect(sockets).toHaveLength(1))
  return hook
}

describe('useApplicationStream — message delivery', () => {
  beforeEach(() => {
    sockets.length = 0
    sessionImpl = () => Promise.resolve({ data: { session: { access_token: 'tok' } } })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('happy path: emits with a UUID client id and clears the sending mark on receipt', async () => {
    const { result } = await mounted()
    const s = sockets[0]
    open(s)

    act(() => { result.current.sendMessage('My date of marriage is 2019-04-02') })
    const payload = messageEmits(s)[0][1] as { text: string; clientMsgId: string }
    expect(payload.text).toBe('My date of marriage is 2019-04-02')
    expect(payload.clientMsgId).toMatch(UUID)
    expect(result.current.messages.at(-1)).toMatchObject({
      msgId: payload.clientMsgId,
      role: 'user',
      status: 'sending',
    })

    act(() => s.handlers['intake:received']?.({ clientMsgId: payload.clientMsgId }))
    expect(result.current.messages.at(-1)?.status).toBeUndefined()
    expect(result.current.isLoading).toBe(true)
  })

  it('2026-10-24: a message typed while the session is still loading is held, then delivered', async () => {
    let resolveSession!: (v: unknown) => void
    sessionImpl = () => new Promise(r => { resolveSession = r })
    const { result } = renderHook(() => useApplicationStream({ applicationId: 'app-1' }))

    // No socket exists yet. The old code skipped the emit here.
    expect(sockets).toHaveLength(0)
    act(() => { result.current.sendMessage('correction') })
    expect(result.current.messages.map(m => m.content)).toEqual(['correction'])

    await act(async () => { resolveSession({ data: { session: { access_token: 'tok' } } }) })
    await waitFor(() => expect(sockets).toHaveLength(1))
    const s = sockets[0]
    open(s)

    // The history did not wipe it, and it went out once the session opened.
    expect(result.current.messages.map(m => m.content)).toEqual([
      'Your intake is complete.',
      'correction',
    ])
    expect(messageEmits(s)).toHaveLength(1)
    expect(result.current.isLoading).toBe(true)
  })

  it('2026-10-24: if the session never loads, the message is marked failed with an error', async () => {
    let rejectSession!: (e: Error) => void
    sessionImpl = () => new Promise((_, rej) => { rejectSession = rej })
    const { result } = renderHook(() => useApplicationStream({ applicationId: 'app-1' }))
    act(() => { result.current.sendMessage('correction') })
    await act(async () => {
      rejectSession(new Error('Could not reach the sign-in service. Check your connection and try again.'))
    })

    await waitFor(() => expect(result.current.messages.at(-1)?.status).toBe('failed'))
    expect(result.current.messages.at(-1)?.content).toBe('correction')
    expect(result.current.error).toMatch(/sign-in service/)
    expect(result.current.isLoading).toBe(false)
  })

  it('a message the socket never takes fails after the timeout instead of vanishing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result } = await mounted()
    // Socket built but never connects (API restarting).
    act(() => { result.current.sendMessage('correction') })
    expect(messageEmits(sockets[0])).toHaveLength(0)

    act(() => { vi.advanceTimersByTime(DELIVERY_TIMEOUT_MS + 10) })
    expect(result.current.messages.at(-1)).toMatchObject({ content: 'correction', status: 'failed' })
    expect(result.current.error).toBe(NOT_SENT_ERROR)
    expect(result.current.isLoading).toBe(false)
  })

  it('2026-10-21: an auth re-handshake replacing the socket does not lose the message', async () => {
    const { result } = await mounted()
    const old = sockets[0]
    open(old)

    // API restarts: the socket drops. The applicant types meanwhile.
    act(() => {
      old.connected = false
      old.handlers['disconnect']?.('transport close')
    })
    act(() => { result.current.sendMessage('correction') })
    // Nothing is handed to a disconnected socket (whose buffer is about to be
    // discarded with it).
    expect(messageEmits(old)).toHaveLength(0)

    // Reconnect is refused for the expired handshake token -> new socket.
    act(() => old.handlers['connect_error']?.(new Error('Unauthorized: invalid token')))
    await waitFor(() => expect(sockets).toHaveLength(2))
    const fresh = sockets[1]
    open(fresh)

    expect(messageEmits(fresh)).toHaveLength(1)
    expect(result.current.messages.at(-1)).toMatchObject({ content: 'correction', status: 'sending' })
  })

  it('a send in flight when the connection drops is marked failed, not left spinning', async () => {
    const { result } = await mounted()
    const s = sockets[0]
    open(s)
    act(() => { result.current.sendMessage('correction') })
    expect(messageEmits(s)).toHaveLength(1)

    act(() => {
      s.connected = false
      s.handlers['disconnect']?.('transport close')
    })
    expect(result.current.messages.at(-1)?.status).toBe('failed')
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBe(NOT_SENT_ERROR)
  })

  it('B1: a held message lock (no receipt) leaves the bubble failed with its retry, and no start replay wipes it', async () => {
    const { result } = await mounted()
    const s = sockets[0]
    open(s)
    act(() => { result.current.sendMessage('correction') })
    const id = lastId(s)
    act(() =>
      s.handlers['intake:error']?.({
        message: 'Your previous message is still being answered. Wait a moment, then send this one again.',
        retryable: true,
        clientMsgId: id,
      }),
    )
    expect(result.current.messages.at(-1)).toMatchObject({ msgId: id, status: 'failed' })
    expect(result.current.error).toMatch(/still being answered/)
    // A turn error on an open session does not re-run the start (whose
    // history used to clear the banner).
    expect(startEmits(s)).toHaveLength(1)

    // Even if a history arrives (a reconnect), the unstored message stays.
    act(() => s.handlers['intake:history']?.(HISTORY))
    expect(result.current.messages.at(-1)).toMatchObject({ msgId: id, status: 'failed' })
  })

  it('B1: an error for a message that WAS acknowledged still marks it failed', async () => {
    const { result } = await mounted()
    const s = sockets[0]
    open(s)
    act(() => { result.current.sendMessage('correction') })
    const id = lastId(s)
    act(() => s.handlers['intake:received']?.({ clientMsgId: id }))
    act(() => s.handlers['intake:error']?.({ message: 'model down', retryable: true, clientMsgId: id }))
    expect(result.current.messages.at(-1)).toMatchObject({ msgId: id, status: 'failed' })
  })

  it('B2: two identical short answers are both kept through a history replay', async () => {
    const { result } = await mounted()
    const s = sockets[0]
    open(s)
    // First "yes" is stored and answered.
    act(() => { result.current.sendMessage('yes') })
    const first = lastId(s)
    act(() => s.handlers['intake:received']?.({ clientMsgId: first }))
    act(() => s.handlers['intake:message']?.({ role: 'assistant', content: 'Any children?', clientMsgId: first }))
    // Second "yes" is in flight when the history is replayed (reconnect).
    act(() => { result.current.sendMessage('yes') })
    const second = lastId(s)
    expect(second).not.toBe(first)
    act(() =>
      s.handlers['intake:history']?.({
        ...HISTORY,
        messages: [
          OPENING,
          { id: first, role: 'user', content: 'yes' },
          { id: 'a2', role: 'assistant', content: 'Any children?' },
        ],
      }),
    )
    const yeses = result.current.messages.filter(m => m.content === 'yes')
    expect(yeses.map(m => m.msgId)).toEqual([first, second])
    expect(yeses[1].status).toBe('sending')
  })

  it('B2: resend reuses the failed message id and replaces it in place', async () => {
    const { result } = await mounted()
    const s = sockets[0]
    open(s)
    act(() => { result.current.sendMessage('correction') })
    const id = lastId(s)
    act(() => s.handlers['intake:error']?.({ message: 'x', retryable: true, clientMsgId: id }))
    expect(result.current.messages.at(-1)?.status).toBe('failed')

    act(() => result.current.resend(id))
    const users = result.current.messages.filter(m => m.role === 'user')
    expect(users).toHaveLength(1)
    expect(users[0]).toMatchObject({ msgId: id, content: 'correction', status: 'sending' })
    expect(messageEmits(s)).toHaveLength(2)
    expect(lastId(s)).toBe(id)
  })

  it('B2: a history that already holds the pending message confirms it (receipt lost, server re-synced)', async () => {
    const { result } = await mounted()
    const s = sockets[0]
    open(s)
    act(() => { result.current.sendMessage('yes') })
    const id = lastId(s)
    act(() =>
      s.handlers['intake:history']?.({
        ...HISTORY,
        messages: [OPENING, { id, role: 'user', content: 'yes' }],
      }),
    )
    const users = result.current.messages.filter(m => m.role === 'user')
    expect(users).toEqual([{ msgId: id, role: 'user', content: 'yes', checklistItems: undefined }])
    expect(result.current.isLoading).toBe(false)
  })

  it('S3: a late receipt clears the failed mark on that message', async () => {
    const { result } = await mounted()
    const s = sockets[0]
    open(s)
    act(() => { result.current.sendMessage('correction') })
    const id = lastId(s)
    act(() => {
      s.connected = false
      s.handlers['disconnect']?.('transport close')
    })
    expect(result.current.messages.at(-1)?.status).toBe('failed')

    act(() => s.handlers['intake:received']?.({ clientMsgId: id }))
    expect(result.current.messages.at(-1)?.status).toBeUndefined()
    expect(result.current.error).toBeNull()
  })

  it('S3: the receipt clock starts at emit, not at send', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result } = await mounted()
    const s = sockets[0]
    act(() => { result.current.sendMessage('correction') })
    // The session takes most of the window to open.
    act(() => { vi.advanceTimersByTime(DELIVERY_TIMEOUT_MS - 1000) })
    open(s)
    expect(messageEmits(s)).toHaveLength(1)
    act(() => { vi.advanceTimersByTime(5000) })
    expect(result.current.messages.at(-1)?.status).toBe('sending')
    act(() => { vi.advanceTimersByTime(DELIVERY_TIMEOUT_MS) })
    expect(result.current.messages.at(-1)?.status).toBe('failed')
  })

  it('S4: against a server without receipts, a slow turn is not reported as lost', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result } = await mounted()
    const s = sockets[0]
    open(s, { messages: [OPENING], isComplete: true }) // no `receipts`
    act(() => { result.current.sendMessage('correction') })
    act(() => { vi.advanceTimersByTime(DELIVERY_TIMEOUT_MS * 3) })
    expect(result.current.messages.at(-1)?.status).toBe('sending')
    expect(result.current.error).toBeNull()

    // The reply confirms it.
    act(() => s.handlers['intake:message']?.({ role: 'assistant', content: 'Updated.' }))
    expect(result.current.messages.find(m => m.content === 'correction')?.status).toBeUndefined()
    expect(result.current.isLoading).toBe(false)
  })

  it('S4: a reply clears a stale "not sent" banner', async () => {
    const { result } = await mounted()
    const s = sockets[0]
    open(s)
    act(() => { result.current.sendMessage('correction') })
    const id = lastId(s)
    act(() => {
      s.connected = false
      s.handlers['disconnect']?.('transport close')
    })
    expect(result.current.error).toBe(NOT_SENT_ERROR)
    act(() => s.handlers['intake:message']?.({ role: 'assistant', content: 'Updated.', clientMsgId: id }))
    expect(result.current.error).toBeNull()
  })

  it('S6: a chunk or reply for ANOTHER message does not confirm the waiting one', async () => {
    const { result } = await mounted()
    const s = sockets[0]
    open(s)
    act(() => { result.current.sendMessage('second') })
    const other = '00000000-0000-4000-8000-000000000000'
    act(() => s.handlers['intake:token']?.({ turnId: 't0', delta: 'late', clientMsgId: other }))
    act(() => s.handlers['intake:message']?.({ role: 'assistant', content: 'late reply', turnId: 't0', clientMsgId: other }))
    expect(result.current.messages.find(m => m.content === 'second')?.status).toBe('sending')
    expect(result.current.isLoading).toBe(true)
  })

  it('2026-10-24: start refused (no access) → send is refused, nothing emitted, error stays', async () => {
    const { result } = await mounted()
    const s = sockets[0]
    act(() => {
      s.connected = true
      s.handlers['connect']?.()
    })
    act(() =>
      s.handlers['intake:error']?.({
        message: 'You do not have access to this application.',
        retryable: false,
      }),
    )
    expect(result.current.canSend).toBe(false)

    let accepted = true
    act(() => { accepted = result.current.sendMessage('correction') })
    expect(accepted).toBe(false)
    expect(messageEmits(s)).toHaveLength(0)
    expect(result.current.messages).toEqual([])
    expect(result.current.error).toBe('You do not have access to this application.')
    expect(result.current.isLoading).toBe(false)
  })

  it('a refused session reopens on retry and accepts messages again', async () => {
    const { result } = await mounted()
    act(() => sockets[0].handlers['intake:error']?.({ message: 'denied', retryable: false }))
    expect(result.current.canSend).toBe(false)

    act(() => result.current.retry())
    await waitFor(() => expect(sockets).toHaveLength(2))
    open(sockets[1])
    expect(result.current.canSend).toBe(true)
    act(() => { result.current.sendMessage('correction') })
    expect(messageEmits(sockets[1])).toHaveLength(1)
  })

  it('a session fetch that fails before any send blocks sending instead of queueing into nothing', async () => {
    sessionImpl = () => Promise.reject(new Error('Could not reach the sign-in service.'))
    const { result } = renderHook(() => useApplicationStream({ applicationId: 'app-1' }))
    await waitFor(() => expect(result.current.canSend).toBe(false))
    let accepted = true
    act(() => { accepted = result.current.sendMessage('correction') })
    expect(accepted).toBe(false)
    expect(result.current.error).toMatch(/sign-in service/)
  })

  it('a pending message is not carried over to another application', async () => {
    const { result, rerender } = renderHook(
      ({ id }) => useApplicationStream({ applicationId: id }),
      { initialProps: { id: 'app-1' } },
    )
    await waitFor(() => expect(sockets).toHaveLength(1))
    act(() => { result.current.sendMessage('for app 1') })
    rerender({ id: 'app-2' })
    await waitFor(() => expect(sockets).toHaveLength(2))
    // Not left spinning either: marked failed, with its retry.
    expect(result.current.messages.find(m => m.content === 'for app 1')?.status).toBe('failed')
    open(sockets[1])
    expect(messageEmits(sockets[1])).toHaveLength(0)
  })

  it('S1: a re-sync history without a checklist keeps the snapshot already on screen', async () => {
    const { result } = await mounted()
    const s = sockets[0]
    const checklist = [{ id: 'c1', document_type: 'passport', label: 'Passport', status: 'pending' }]
    open(s, { ...HISTORY, checklistItems: checklist })
    expect(result.current.messages.at(-1)?.checklistItems).toEqual(checklist)

    act(() => s.handlers['intake:history']?.({ messages: [OPENING], receipts: true }))
    expect(result.current.messages.at(-1)?.checklistItems).toEqual(checklist)
  })

  it('S2: a refresh ping re-reads the transcript when idle, never mid-turn', async () => {
    const { result } = await mounted()
    const s = sockets[0]
    open(s)
    expect(startEmits(s)).toHaveLength(1)

    act(() => s.handlers['intake:refresh']?.({ applicationId: 'app-1' }))
    expect(startEmits(s)).toHaveLength(2)

    act(() => { result.current.sendMessage('correction') })
    act(() => s.handlers['intake:refresh']?.({ applicationId: 'app-1' }))
    expect(startEmits(s)).toHaveLength(2)
  })
})

describe('mergeHistory', () => {
  const hist = [
    { msgId: 'a', role: 'assistant' as const, content: 'Q?' },
    { msgId: 'b', role: 'user' as const, content: 'yes' },
  ]

  it('returns the history as-is when nothing local is unconfirmed', () => {
    expect(mergeHistory(hist, [{ msgId: 'x', role: 'user', content: 'old' }])).toBe(hist)
  })

  it('keeps an unconfirmed local message the server does not have — even with the same text', () => {
    const local = [{ msgId: 'x', role: 'user' as const, content: 'yes', status: 'sending' as const }]
    expect(mergeHistory(hist, local).map(m => m.msgId)).toEqual(['a', 'b', 'x'])
  })

  it('drops the local copy once the history holds the same id', () => {
    const local = [{ msgId: 'b', role: 'user' as const, content: 'yes', status: 'failed' as const }]
    expect(mergeHistory(hist, local)).toBe(hist)
  })
})
