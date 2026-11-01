import { getSession, isGuestSession } from '@/lib/supabase/client'
import { drainSseFrames } from '@/lib/sse'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

/**
 * Opens ONE authenticated SSE connection via fetch-stream (so the Authorization
 * header can be set — EventSource cannot). Reads the response body, extracts
 * complete SSE frames with drainSseFrames, JSON-parses each, skips
 * heartbeat/connected keepalives, and calls onFrame for every real event.
 * Auto-reconnects with capped backoff. Returns a cleanup that cancels + aborts.
 *
 * Pure (no React) so any owner — a hub or a component effect — can hold it.
 * Per-stream concerns (which path, what a real frame means) live in the caller.
 */
export function openSseStream(
  path: string,
  onFrame: (payload: Record<string, unknown>) => void,
): () => void {
  let cancelled = false
  let controller: AbortController | null = null
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  async function connect() {
    if (cancelled) return
    const {
      data: { session },
    } = await getSession()
    if (!session || cancelled) return
    // A guest identity is rejected by JwtGuard on every SSE route, and the
    // reconnect below would turn that 403 into an endless retry loop. Stop
    // before connecting rather than backing off forever (BUG-002).
    if (isGuestSession(session)) return

    controller = new AbortController()
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          Accept: 'text/event-stream',
        },
        signal: controller.signal,
      })
      if (!res.ok || !res.body) throw new Error(`stream ${res.status}`)
      attempt = 0 // connected — reset backoff

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (!cancelled) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const { messages, rest } = drainSseFrames(buffer)
        buffer = rest
        for (const msg of messages) {
          let payload: Record<string, unknown>
          try {
            payload = JSON.parse(msg) as Record<string, unknown>
          } catch {
            continue
          }
          if (payload.heartbeat || payload.connected) continue // keepalive / handshake
          onFrame(payload)
        }
      }
    } catch {
      // network error or stream closed — fall through to reconnect
    } finally {
      if (!cancelled) {
        attempt = Math.min(attempt + 1, 6)
        timer = setTimeout(() => void connect(), 1000 * attempt)
      }
    }
  }

  void connect()
  return () => {
    cancelled = true
    controller?.abort()
    if (timer) clearTimeout(timer)
  }
}
