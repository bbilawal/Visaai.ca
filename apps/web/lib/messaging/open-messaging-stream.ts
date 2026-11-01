import type { MessagingStreamEvent } from '@visaai/types'
import { openSseStream } from '@/lib/sse-stream'

/**
 * Opens ONE messaging SSE connection. Thin wrapper over openSseStream: it owns
 * only the path and the messaging frame filter (a real messaging event has both
 * `type` and `conversation_id`). Same signature as before, so the stream hub and
 * its subscribers (bell, thread) are unaffected.
 */
export function openMessagingStream(
  onEvent: (e: MessagingStreamEvent) => void,
): () => void {
  return openSseStream('/messaging/stream', (p) => {
    if (p.type && p.conversation_id) {
      onEvent(p as unknown as MessagingStreamEvent)
    }
  })
}
