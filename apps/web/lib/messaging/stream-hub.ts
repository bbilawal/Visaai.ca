import type { MessagingStreamEvent } from '@visaai/types'

type Subscriber = (e: MessagingStreamEvent) => void
type Connect = (onEvent: (e: MessagingStreamEvent) => void) => () => void

/**
 * Holds ONE upstream connection shared by many subscribers. Opens (via the
 * injected `connect`) when the first subscriber joins; fans each event out to
 * every subscriber (one throwing callback never blocks the rest); closes when
 * the last subscriber leaves. Framework-agnostic → unit-testable.
 */
export function createStreamHub(connect: Connect) {
  const subscribers = new Set<Subscriber>()
  let close: (() => void) | null = null

  const fanOut = (e: MessagingStreamEvent) => {
    for (const cb of subscribers) {
      try {
        cb(e)
      } catch {
        // an individual subscriber error must not break fan-out
      }
    }
  }

  function subscribe(cb: Subscriber): () => void {
    subscribers.add(cb)
    if (subscribers.size === 1) {
      close = connect(fanOut)
    }
    return () => {
      subscribers.delete(cb)
      if (subscribers.size === 0 && close) {
        close()
        close = null
      }
    }
  }

  return { subscribe }
}
