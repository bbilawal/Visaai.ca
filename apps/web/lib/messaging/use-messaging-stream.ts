'use client'

import { useEffect, useRef } from 'react'
import type { MessagingStreamEvent } from '@visaai/types'
import { useMessagingStreamContext } from './messaging-stream'

/**
 * Subscribes to the shared messaging SSE stream (one connection per tab, held by
 * MessagingStreamProvider) and calls `onEvent` for each relevant event. Without
 * a provider in the tree, the context default opens a standalone connection
 * (legacy behavior). The cbRef keeps the latest callback without re-subscribing.
 *
 * Caller responsibility (Option A): on each event, refetch the authoritative
 * data from the backend rather than deriving local state from the event.
 */
export function useMessagingStream(onEvent: (e: MessagingStreamEvent) => void) {
  const cbRef = useRef(onEvent)
  cbRef.current = onEvent
  const { subscribe } = useMessagingStreamContext()

  useEffect(() => {
    return subscribe((e) => cbRef.current(e))
  }, [subscribe])
}
