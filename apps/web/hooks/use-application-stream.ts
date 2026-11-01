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

    async function connect() {
      try {
        const token = await getSessionWithRetry()
        if (!token || cancelled) {
          if (!token) {
            // The surface renders a localized line for this case; the string
            // here is only a fallback for any other consumer of the hook.
            setNeedsAuth(true)
            setError('Not authenticated')
          }
          return
        }
        setNeedsAuth(false)

        resetIntakeSocket()
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
            return
          }
          // Transient transport error (e.g. API still booting). socket.io
          // auto-reconnects, so stay quiet rather than flashing an error.
          console.warn('[intake stream] transient connect error, retrying:', msg)
        })

        s.on('disconnect', (reason) => {
          if (cancelled) return
          console.warn('[intake stream] socket disconnect', reason)
        })

        s.on('intake:history', (data: {
          messages: Array<{ id: string; role: 'user' | 'assistant'; content: string }>
          checklistItems?: IntakeMessage['checklistItems']
          isComplete?: boolean
        }) => {
          if (cancelled) return
          setIsLoading(false)
          const hydrated: IntakeMessage[] = data.messages.map((m, i) => ({
            msgId: m.id,
            role: m.role,
            content: m.content,
            // Attach the latest checklist snapshot to the last assistant message
            // so the sidebar has something to render on first paint.
            checklistItems: i === data.messages.length - 1 && m.role === 'assistant'
              ? data.checklistItems
              : undefined,
          }))
          setMessages(hydrated)
          startRetriesRef.current = 0
          setError(null)
          if (data.isComplete) setIsComplete(true)
        })

        // Chunks of the reply as the model writes it. `turnId` guards against
        // two overlapping turns on one socket (a reconnect can replay a send)
        // splicing their text together.
        s.on('intake:token', (data: { turnId?: string; delta: string }) => {
          if (cancelled || !data.delta) return
          if (turnIdRef.current && data.turnId && data.turnId !== turnIdRef.current) return
          turnIdRef.current = data.turnId ?? turnIdRef.current
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

        s.on('intake:message', (data: Omit<IntakeMessage, 'msgId'> & { turnId?: string }) => {
          if (cancelled) return
          setIsLoading(false)
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
          if (data.isComplete) setIsComplete(true)
        })

        s.on('intake:error', (data: { message: string; retryable?: boolean }) => {
          if (cancelled) return
          setIsLoading(false)
          turnIdRef.current = null
          setStreamingContent(null)
          setError(data.message)

          // A failed start is not the end of the interview. The server says
          // whether trying again can work; if it can, re-open the session on a
          // backoff. Without this the applicant kept typing into a session
          // that was never created and every turn failed identically, with a
          // page reload the only (undocumented) way out.
          if (data.retryable === false) return
          if (startRetriesRef.current >= maxStartRetries) return
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
          console.error('Socket connection error:', err)
        }
      }
    }

    reconnectRef.current = () => {
      if (cancelled) return
      startRetriesRef.current = 0
      setError(null)
      void connect()
    }

    connect()

    return () => {
      cancelled = true
      reconnectRef.current = null
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
  }, [applicationId])

  const sendMessage = useCallback((text: string) => {
    setMessages(prev => [...prev, {
      msgId: `${Date.now()}-${Math.random()}`,
      role: 'user',
      content: text,
    }])
    setIsLoading(true)
    turnIdRef.current = null
    setStreamingContent(null)
    setError(null)
    socketRef.current?.emit('intake:message', { applicationId, text })
  }, [applicationId])

  /**
   * Manual recovery for the applicant, for when the automatic retries are
   * spent or the token behind the socket has expired.
   */
  const retry = useCallback(() => {
    resetIntakeSocket()
    reconnectRef.current?.()
  }, [])

  return { messages, streamingContent, isLoading, isComplete, error, needsAuth, retry, sendMessage }
}
