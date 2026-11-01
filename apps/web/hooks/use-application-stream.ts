'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { getIntakeSocket, resetIntakeSocket } from '@/lib/socket'
import { getSession } from '@/lib/supabase/client'

export interface IntakeMessage {
  msgId: string
  role: 'user' | 'assistant'
  content: string
  checklistItems?: Array<{
    id: string
    document_type: string
    label: string
    status: string
    meta?: {
      kind?: 'form' | 'document'
      owner?: 'applicant' | 'sponsor'
      strength?: boolean
      form_code?: string | null
      form_name?: string | null
      source_url?: string | null
      specs?: Record<string, string>
    } | null
  }>
  isComplete?: boolean
  /**
   * Delivery state of an applicant message the server has not acknowledged.
   * `sending`: on its way, or waiting for the socket. `failed`: it was not
   * accepted — the bubble stays on screen with a retry instead of vanishing
   * (prod 2026-10-21 and 2026-10-24: messages typed after an API restart, or
   * while the session refresh was failing, disappeared without a trace).
   * Absent once the server has stored it.
   */
  status?: 'sending' | 'failed'
}

/**
 * How long a message may wait before the applicant is told it was not sent.
 *
 * Two clocks, both this long:
 *  - before it is handed to a socket: no socket yet (the session still being
 *    fetched — up to 15s while a token refresh fails), or one reconnecting;
 *  - after it is handed over, waiting for the server's `intake:received`.
 *    That one only runs against a server known to send receipts, so a
 *    receipt-less (older) API is never mistaken for a lost message.
 */
export const DELIVERY_TIMEOUT_MS = 20_000

/** Fallback text for an undelivered message; the page shows a localized line. */
export const NOT_SENT_ERROR = 'Your message was not sent. Check your connection and try again.'

interface PendingSend {
  msgId: string
  text: string
  /** Handed to a connected socket (it can still be lost in transit). */
  emitted: boolean
}

/**
 * The client's id for a message, which the server stores as the row id. A
 * UUID, so the server can use it as the primary key, dedupe a resend, and hand
 * it back in the history.
 */
function newMessageId(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c?.randomUUID) return c.randomUUID()
  // RFC 4122 v4 from getRandomValues, or Math.random as a last resort.
  const bytes = new Uint8Array(16)
  if (c?.getRandomValues) c.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const h = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/**
 * The history the server sent, plus the applicant's own unconfirmed messages
 * it does not contain.
 *
 * `intake:history` used to REPLACE the list. It is replayed on every
 * (re)connect and every start retry, so a message typed moments earlier — in
 * flight, or never delivered — was wiped off the screen as if it had never
 * been typed. Matching is by id (the server stores the client's id as the
 * row id), never by text: two identical answers ("yes", "none") are two
 * messages.
 */
export function mergeHistory(hydrated: IntakeMessage[], local: IntakeMessage[]): IntakeMessage[] {
  const unconfirmed = local.filter(m => m.role === 'user' && m.status)
  if (unconfirmed.length === 0) return hydrated
  const known = new Set(hydrated.map(m => m.msgId))
  const kept = unconfirmed.filter(m => !known.has(m.msgId))
  return kept.length === 0 ? hydrated : [...hydrated, ...kept]
}

interface UseApplicationStreamOptions {
  applicationId: string
}

export function useApplicationStream({ applicationId }: UseApplicationStreamOptions) {
  const [messages, setMessages] = useState<IntakeMessage[]>([])
  /**
   * The reply currently being written, as far as it has arrived.
   *
   * Held separately from `messages` rather than as a mutable last entry,
   * because it is a PREVIEW, not the reply. The authoritative text is the
   * `intake:message` that closes the turn — it is the one the server has run
   * its output guardrail over, and it may differ from what streamed. Keeping
   * the two apart makes that replacement a single assignment instead of a
   * surgical edit of the message list.
   */
  const [streamingContent, setStreamingContent] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * The failure is a missing session, not a broken one.
   *
   * Retrying cannot fix it — `getSession` will keep returning nothing — so the
   * surface offers sign-in instead of a "Try again" that loops. Reached when a
   * session is lost mid-application: an expiry, a sign-out, or an OAuth round
   * trip that never came back (a provider 500 is enough).
   */
  const [needsAuth, setNeedsAuth] = useState(false)
  /**
   * Whether a message can be sent at all. False once opening the session has
   * failed for good — signed out, signed in as someone without access, the
   * sign-in service unreachable, start retries spent. Sending into that used
   * to clear the input, clear the error banner and emit into a session that
   * did not exist: the text vanished and the reason did too (prod 2026-10-24,
   * "You do not have access to this application." then a silent send).
   */
  const [canSend, setCanSend] = useState(true)
  const blockedRef = useRef(false)
  const socketRef = useRef<ReturnType<typeof getIntakeSocket> | null>(null)
  /** The turn whose chunks we are currently accepting. */
  const turnIdRef = useRef<string | null>(null)
  /**
   * Rebuilds the socket with a FRESH access token. Held in a ref so `retry`
   * can reach the connect defined inside the effect. Reconnecting rather than
   * re-emitting on the old socket is deliberate: the token is bound at
   * handshake and never refreshed, so a session that outlives it can only be
   * recovered by handshaking again.
   */
  const reconnectRef = useRef<(() => void) | null>(null)
  /** Automatic start retries spent on this mount. */
  const startRetriesRef = useRef(0)
  /** Whether the one automatic re-handshake with a fresh token has been used. */
  const authRetriedRef = useRef(false)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The applicant message waiting for the server's receipt, if any. */
  const pendingRef = useRef<PendingSend | null>(null)
  const deliveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * The current socket has opened the session (`intake:history` arrived). A
   * message is handed over only after that, so it is never processed ahead of
   * — or lost behind — the start that re-opens the interview.
   */
  const readyRef = useRef(false)
  /**
   * The server on this socket sends `intake:received`. Until it is known to,
   * a handed-over message is never timed out — an older API without receipts
   * would otherwise have every slow turn reported as "not sent".
   */
  const receiptsRef = useRef(false)
  /** `isLoading`, readable from socket handlers without re-subscribing. */
  const loadingRef = useRef(false)
  useEffect(() => { loadingRef.current = isLoading }, [isLoading])

  const clearDeliveryTimer = useCallback(() => {
    if (deliveryTimerRef.current) {
      clearTimeout(deliveryTimerRef.current)
      deliveryTimerRef.current = null
    }
  }, [])

  const setStatus = useCallback((msgId: string, status: IntakeMessage['status']) => {
    setMessages(prev => {
      if (!prev.some(m => m.msgId === msgId && m.status !== status)) return prev
      return prev.map(m => (m.msgId === msgId ? { ...m, status } : m))
    })
  }, [])

  /**
   * The server has the message. With an id, that message (pending or not: a
   * late receipt for one already marked failed un-fails it). Without one — a
   * reply from a server that does not tag replies — the pending message.
   */
  const confirm = useCallback((msgId?: string) => {
    const pending = pendingRef.current
    const id = msgId ?? pending?.msgId
    if (!id) return
    if (pending && pending.msgId === id) {
      pendingRef.current = null
      clearDeliveryTimer()
    }
    setStatus(id, undefined)
    // A "not sent" banner is stale once the server turns out to have it.
    setError(prev => (prev === NOT_SENT_ERROR ? null : prev))
  }, [clearDeliveryTimer, setStatus])

  /** Mark a message failed, keeping it on screen with its retry. */
  const fail = useCallback((reason: string, msgId?: string) => {
    const pending = pendingRef.current
    const id = msgId ?? pending?.msgId
    if (!id) return
    if (pending && pending.msgId === id) {
      pendingRef.current = null
      clearDeliveryTimer()
      setIsLoading(false)
    }
    setStatus(id, 'failed')
    setError(reason)
  }, [clearDeliveryTimer, setStatus])

  const failPending = useCallback((reason: string) => {
    if (pendingRef.current) fail(reason, pendingRef.current.msgId)
  }, [fail])

  const blockSending = useCallback((reason: string) => {
    failPending(reason)
    blockedRef.current = true
    setCanSend(false)
  }, [failPending])

  const unblockSending = useCallback(() => {
    blockedRef.current = false
    setCanSend(true)
  }, [])

  /** Hand the pending message to the socket, if the socket can take it now. */
  const flushPending = useCallback(() => {
    const pending = pendingRef.current
    const s = socketRef.current
    if (!pending || pending.emitted || !s?.connected || !readyRef.current) return
    pending.emitted = true
    s.emit('intake:message', { applicationId, text: pending.text, clientMsgId: pending.msgId })
    // The receipt clock starts now, not at send — waiting for the session to
    // open is not the server being slow to answer.
    clearDeliveryTimer()
    if (receiptsRef.current) {
      const { msgId } = pending
      deliveryTimerRef.current = setTimeout(() => {
        if (pendingRef.current?.msgId === msgId) fail(NOT_SENT_ERROR, msgId)
      }, DELIVERY_TIMEOUT_MS)
    }
  }, [applicationId, clearDeliveryTimer, fail])

  useEffect(() => {
    let cancelled = false
    let retryCount = 0
    const maxRetries = 3
    const maxStartRetries = 3

    async function getSessionWithRetry(): Promise<string | null> {
      try {
        const { data: { session } } = await getSession()
        return session?.access_token ?? null
      } catch (err) {
        if (retryCount < maxRetries && (err instanceof Error && err.message.includes('lock'))) {
          retryCount++
          console.warn(`Auth lock timeout, retrying (${retryCount}/${maxRetries})...`)
          await new Promise(resolve => setTimeout(resolve, 500 * retryCount))
          return getSessionWithRetry()
        }
        throw err
      }
    }

    async function prefillTranscript(token: string) {
      const api = process.env.NEXT_PUBLIC_API_URL
      if (!api) return
      try {
        const res = await fetch(`${api}/intake/applications/${applicationId}/messages`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) return
        const rows = (await res.json()) as Array<{ id: string; role: 'user' | 'assistant'; content: string }>
        if (cancelled || !Array.isArray(rows) || rows.length === 0) return
        setMessages(prev =>
          prev.length > 0
            ? prev
            : rows.map(m => ({ msgId: m.id, role: m.role, content: m.content })),
        )
      } catch {
        // Best effort only; the socket history follows.
      }
    }

    async function connect() {
      // Not open until THIS connection's history arrives. Cleared before the
      // session wait, so nothing is handed to the old socket meanwhile.
      readyRef.current = false
      try {
        const token = await getSessionWithRetry()
        if (!token || cancelled) {
          if (!token) {
            // The surface renders a localized line for this case; the string
            // here is only a fallback for any other consumer of the hook.
            setNeedsAuth(true)
            setError('Not authenticated')
            blockSending('Not authenticated')
          }
          return
        }
        setNeedsAuth(false)

        // Paint the stored transcript straight away. The socket's
        // `intake:history` only arrives once the server has resumed the
        // interview, which can take seconds — on a reload the page sat on an
        // empty chat for that long (dry run 2026-10-16). The socket's history
        // stays authoritative: it replaces this whenever it lands, and this
        // never overwrites anything already on screen.
        void prefillTranscript(token)

        resetIntakeSocket()
        readyRef.current = false
        receiptsRef.current = false
        const s = getIntakeSocket(token)
        socketRef.current = s

        s.on('connect', () => {
          console.log('[intake stream] socket connected')
          if (cancelled) return
          // A handshake that succeeded is proof the token is good again.
          authRetriedRef.current = false
          s.emit('intake:start', { applicationId })
          setIsLoading(true)
        })

        s.connect()

        s.on('connect_error', (err) => {
          if (cancelled) return
          const msg = err instanceof Error ? err.message : String(err)
          if (msg.toLowerCase().includes('unauthorized')) {
            // Retrying the SAME token cannot work — which is what this branch
            // used to conclude, and why it gave up. But socket.io replays the
            // `auth.token` bound when the socket was built, and that token has
            // a one-hour life the socket never refreshes. So an interview that
            // outlives it can never reconnect: every retry replays the same
            // expired credential. Seen on production 2026-09-03 as
            // `[jwt] Supabase token validation failed: ... token is expired`
            // on the gateway handshake.
            //
            // Handshaking AGAIN with a FRESH token does recover it —
            // supabase-js has already rotated the session in the background.
            // Once per mount, so a genuinely unauthorized caller cannot loop;
            // a successful connect clears the budget for the next expiry.
            if (!authRetriedRef.current) {
              authRetriedRef.current = true
              console.warn('[intake stream] handshake unauthorized — reconnecting with a fresh token')
              resetIntakeSocket()
              void connect()
              return
            }
            setIsLoading(false)
            setError(msg)
            blockSending(msg)
            return
          }
          // Transient transport error (e.g. API still booting). socket.io
          // auto-reconnects, so stay quiet rather than flashing an error.
          console.warn('[intake stream] transient connect error, retrying:', msg)
        })

        s.on('disconnect', (reason) => {
          if (cancelled) return
          console.warn('[intake stream] socket disconnect', reason)
          readyRef.current = false
          // Handed over but never acknowledged: it may have died with the
          // connection. Say so now rather than at the timeout — if the server
          // did store it, the history replayed on reconnect holds its id and
          // the failed copy gives way to it.
          if (pendingRef.current?.emitted) failPending(NOT_SENT_ERROR)
        })

        // The server has STORED the applicant's message (it is sent after the
        // write, so a turn that fails before it is never reported as received).
        s.on('intake:received', (data: { clientMsgId?: string }) => {
          if (cancelled) return
          receiptsRef.current = true
          if (data?.clientMsgId) confirm(data.clientMsgId)
        })

        s.on('intake:history', (data: {
          messages: Array<{ id: string; role: 'user' | 'assistant'; content: string }>
          checklistItems?: IntakeMessage['checklistItems']
          isComplete?: boolean
          /** The server acknowledges each message with `intake:received`. */
          receipts?: boolean
        }) => {
          if (cancelled) return
          if (data.receipts) receiptsRef.current = true
          setIsLoading(false)
          const hydrate = (checklist: IntakeMessage['checklistItems']): IntakeMessage[] =>
            data.messages.map((m, i) => ({
              msgId: m.id,
              role: m.role,
              content: m.content,
              // Attach the latest checklist snapshot to the last assistant
              // message so the sidebar has something to render on first paint.
              checklistItems: i === data.messages.length - 1 && m.role === 'assistant'
                ? checklist
                : undefined,
            }))
          const hydrated = hydrate(data.checklistItems)
          setMessages(prev => {
            // A history without a checklist (a re-sync) is not a statement
            // that the checklist is empty: keep the snapshot already on screen.
            const checklist = data.checklistItems
              ?? [...prev].reverse().find(m => m.checklistItems)?.checklistItems
            return mergeHistory(data.checklistItems ? hydrated : hydrate(checklist), prev)
          })
          // The server already has the pending message (its receipt was lost):
          // it is delivered, not to be sent again.
          const pending = pendingRef.current
          if (pending && hydrated.some(m => m.msgId === pending.msgId)) confirm(pending.msgId)
          startRetriesRef.current = 0
          setError(null)
          unblockSending()
          if (data.isComplete) setIsComplete(true)
          // The session is open: a message typed while it was opening goes now.
          readyRef.current = true
          if (pendingRef.current) {
            setIsLoading(true)
            flushPending()
          }
        })

        // Another of this applicant's sockets finished a turn on this
        // application — typically the one a resend was re-synced away from,
        // whose reply could not reach this page. Re-read the transcript, but
        // never in the middle of a turn of our own.
        s.on('intake:refresh', () => {
          if (cancelled || !readyRef.current || pendingRef.current || loadingRef.current) return
          s.emit('intake:start', { applicationId })
        })

        // Chunks of the reply as the model writes it. `turnId` guards against
        // two overlapping turns on one socket (a reconnect can replay a send)
        // splicing their text together.
        s.on('intake:token', (data: { turnId?: string; delta: string; clientMsgId?: string }) => {
          if (cancelled || !data.delta) return
          if (turnIdRef.current && data.turnId && data.turnId !== turnIdRef.current) return
          turnIdRef.current = data.turnId ?? turnIdRef.current
          // A reply to this turn is streaming, so the message it answers was
          // stored. Checked after the turn filter: a chunk from some OTHER
          // turn says nothing about the message waiting now.
          confirm(data.clientMsgId)
          setStreamingContent(prev => (prev ?? '') + data.delta)
        })

        // The turn failed after some text had already been shown. Drop the
        // partial reply rather than leaving half a sentence on screen looking
        // like a finished answer; `intake:error` follows with the reason.
        s.on('intake:token:abort', (data: { turnId?: string }) => {
          if (cancelled) return
          if (turnIdRef.current && data.turnId && data.turnId !== turnIdRef.current) return
          turnIdRef.current = null
          setStreamingContent(null)
        })

        s.on('intake:message', (data: Omit<IntakeMessage, 'msgId'> & { turnId?: string; clientMsgId?: string }) => {
          if (cancelled) return
          // An id names the message this answers. Without one (an older
          // server) the reply confirms the pending message only if it belongs
          // to the turn being followed.
          const sameTurn = !turnIdRef.current || !data.turnId || data.turnId === turnIdRef.current
          if (data.clientMsgId) confirm(data.clientMsgId)
          else if (sameTurn) confirm()
          if (!pendingRef.current) setIsLoading(false)
          // The authoritative reply lands: retire the preview. `data.content`
          // wins even when it differs from what streamed — that difference is
          // the output guardrail having replaced the text, and showing the
          // streamed version instead would defeat it.
          turnIdRef.current = null
          setStreamingContent(null)
          setMessages(prev => [...prev, {
            msgId: `${Date.now()}-${Math.random()}`,
            role: 'assistant',
            content: data.content,
            checklistItems: data.checklistItems,
          }])
          // Follow the server both ways: a correction after completion can
          // remove a required answer, and the interview then resumes. A reply
          // with no flag at all (a guardrail refusal) says nothing about it.
          if (typeof data.isComplete === 'boolean') setIsComplete(data.isComplete)
        })

        s.on('intake:error', (data: { message: string; retryable?: boolean; clientMsgId?: string }) => {
          if (cancelled) return
          setIsLoading(false)
          turnIdRef.current = null
          setStreamingContent(null)
          setError(data.message)
          // A turn that failed: its message stays on screen, marked, with a
          // retry. Named by id when the server knows it; otherwise the message
          // handed over last. One not handed over yet is still waiting for the
          // session and stays queued (or times out).
          if (data.clientMsgId) fail(data.message, data.clientMsgId)
          else if (pendingRef.current?.emitted) failPending(data.message)

          // Everything below is about a failed START. A turn error on an open
          // session must not replay the start: that history used to clear the
          // banner and, with it, the only sign of the failure.
          if (readyRef.current) return

          // The session could not be opened and will not be retried: there is
          // nothing to send into (e.g. the browser is signed in as another
          // user with no access — prod 2026-10-24). Sends are refused, keeping
          // the text, until a retry or reconnect opens it.
          if (data.retryable === false || startRetriesRef.current >= maxStartRetries) {
            blockSending(data.message)
            return
          }

          // A failed start is not the end of the interview. The server says
          // whether trying again can work; if it can, re-open the session on a
          // backoff. Without this the applicant kept typing into a session
          // that was never created and every turn failed identically, with a
          // page reload the only (undocumented) way out.
          const attempt = ++startRetriesRef.current
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
          retryTimerRef.current = setTimeout(() => {
            if (cancelled || !socketRef.current?.connected) return
            setIsLoading(true)
            socketRef.current.emit('intake:start', { applicationId })
          }, 1000 * 2 ** (attempt - 1))
        })
      } catch (err) {
        if (!cancelled) {
          setIsLoading(false)
          setError(err instanceof Error ? err.message : 'Connection failed')
          blockSending(err instanceof Error ? err.message : 'Connection failed')
          console.error('Socket connection error:', err)
        }
      }
    }

    reconnectRef.current = () => {
      if (cancelled) return
      readyRef.current = false
      startRetriesRef.current = 0
      setError(null)
      unblockSending()
      void connect()
    }

    connect()

    return () => {
      cancelled = true
      reconnectRef.current = null
      readyRef.current = false
      // A message typed for this application is not sent to the next one —
      // and is not left spinning as "sending" either: it is marked failed,
      // keeping its retry.
      const pending = pendingRef.current
      pendingRef.current = null
      clearDeliveryTimer()
      if (pending) {
        setMessages(prev => prev.map(m => (m.msgId === pending.msgId ? { ...m, status: 'failed' } : m)))
      }
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
      const s = socketRef.current
      if (s) {
        s.removeAllListeners()
        s.disconnect()
        socketRef.current = null
      }
    }
  }, [applicationId, confirm, fail, failPending, flushPending, clearDeliveryTimer, blockSending, unblockSending])

  /** Queue `text` as message `msgId` and send it as soon as the session can take it. */
  const dispatch = useCallback((msgId: string, text: string) => {
    setIsLoading(true)
    turnIdRef.current = null
    setStreamingContent(null)
    setError(null)
    pendingRef.current = { msgId, text, emitted: false }
    clearDeliveryTimer()
    // The wait for a socket that can take it. Replaced by the receipt clock
    // once it is handed over (flushPending).
    deliveryTimerRef.current = setTimeout(() => {
      if (pendingRef.current?.msgId === msgId && !pendingRef.current.emitted) fail(NOT_SENT_ERROR, msgId)
    }, DELIVERY_TIMEOUT_MS)
    flushPending()
  }, [clearDeliveryTimer, fail, flushPending])

  /**
   * Send an applicant message. It is never dropped silently: it stays in the
   * thread as `sending` until the server has stored it, and is marked `failed`
   * (with `error` set) when that does not happen.
   *
   * It used to `socketRef.current?.emit(...)` and forget. A null socket (the
   * session still loading, or never loading because the token refresh was
   * failing) skipped the send outright; a disconnected socket buffered it into
   * a socket the auth re-handshake then threw away; and the next
   * `intake:history` wiped the bubble. Input cleared, nothing processed, no
   * error — prod 2026-10-21 and 2026-10-24.
   *
   * Returns false — touching nothing, so the error on screen stays — when the
   * session cannot take messages (`canSend` false). The caller keeps the text.
   */
  const sendMessage = useCallback((text: string): boolean => {
    if (blockedRef.current) return false
    // A second message while the first is unconfirmed (the input is disabled
    // while loading, so this is a programmatic or racing send). The first is
    // marked failed so it keeps its own retry rather than being overwritten —
    // and if the server did store it after all, its late receipt or reply
    // clears the mark by id.
    if (pendingRef.current) failPending(NOT_SENT_ERROR)
    const msgId = newMessageId()
    setMessages(prev => [...prev, { msgId, role: 'user', content: text, status: 'sending' }])
    dispatch(msgId, text)
    return true
  }, [dispatch, failPending])

  /**
   * Send a failed message again, in place and under the SAME id: if the first
   * attempt was in fact stored, the server recognises the id and acknowledges
   * it instead of running the turn twice.
   */
  const resend = useCallback((msgId: string) => {
    const failed = messages.find(m => m.msgId === msgId && m.status === 'failed')
    if (!failed || blockedRef.current) return
    if (pendingRef.current) failPending(NOT_SENT_ERROR)
    setStatus(msgId, 'sending')
    dispatch(msgId, failed.content)
  }, [messages, dispatch, failPending, setStatus])

  /**
   * Manual recovery for the applicant, for when the automatic retries are
   * spent or the token behind the socket has expired.
   */
  const retry = useCallback(() => {
    resetIntakeSocket()
    reconnectRef.current?.()
  }, [])

  return { messages, streamingContent, isLoading, isComplete, error, needsAuth, canSend, retry, sendMessage, resend }
}
