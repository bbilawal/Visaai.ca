'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { openSseStream } from '@/lib/sse-stream'

/**
 * Subscribes to the consultant-queue SSE stream and, on any queue event,
 * refetches the authoritative queue via router.refresh() (Option A — no local
 * state derivation, backend is the source of truth). All connection plumbing
 * (auth fetch-stream, reconnect, frame draining) lives in openSseStream; this
 * component owns only the path and what a queue frame means. Renders nothing.
 */
export function QueueLiveRefresh() {
  const router = useRouter()

  useEffect(
    () =>
      openSseStream('/realtime/consultant-queue/stream', (p) => {
        if (p.event_type) router.refresh() // refetch authoritative queue
      }),
    [router],
  )

  return null
}
