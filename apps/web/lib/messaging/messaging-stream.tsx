'use client'

import { createContext, useContext, useRef } from 'react'
import type { MessagingStreamEvent } from '@visaai/types'
import { openMessagingStream } from './open-messaging-stream'
import { createStreamHub } from './stream-hub'

type Subscribe = (cb: (e: MessagingStreamEvent) => void) => () => void

// Default (no provider in the tree): each subscriber opens its own standalone
// connection — exactly today's behavior, so nothing breaks without the provider.
const MessagingStreamContext = createContext<{ subscribe: Subscribe }>({
  subscribe: (cb) => openMessagingStream(cb),
})

export function useMessagingStreamContext() {
  return useContext(MessagingStreamContext)
}

/**
 * Holds ONE messaging SSE connection for the whole authenticated app shell.
 * Mount once (dashboard layout); every useMessagingStream consumer subscribes
 * to the shared hub instead of opening its own connection.
 */
export function MessagingStreamProvider({ children }: { children: React.ReactNode }) {
  const hubRef = useRef<{ subscribe: Subscribe } | null>(null)
  if (!hubRef.current) {
    hubRef.current = createStreamHub(openMessagingStream)
  }
  return (
    <MessagingStreamContext.Provider value={{ subscribe: hubRef.current.subscribe }}>
      {children}
    </MessagingStreamContext.Provider>
  )
}
