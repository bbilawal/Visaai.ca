import { io, Socket } from 'socket.io-client'

let socket: Socket | null = null
let currentToken: string | undefined

export function getIntakeSocket(token?: string): Socket {
  const tokenChanged = token !== currentToken
  if (!socket || tokenChanged) {
    if (socket) {
      socket.disconnect()
      socket = null
    }

    currentToken = token
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
    // polling first, upgrade to websocket. Avoids "WebSocket is already in
    // CLOSING or CLOSED state" warnings when React StrictMode mounts/unmounts
    // the hook within milliseconds (no raw ws is opened during the brief mount).
    socket = io(`${apiUrl}/intake`, {
      autoConnect: false,
      transports: ['polling', 'websocket'],
      auth: token ? { token } : {},
    })

    socket.on('connect', () => {
      console.log('[intake socket] connected', { id: socket?.id, tokenPresent: Boolean(token) })
    })

    socket.on('connect_error', (error) => {
      // Transient during API boot; socket.io auto-reconnects. Warn, don't error.
      console.warn('[intake socket] connect_error', error.message)
    })

    socket.on('disconnect', (reason) => {
      console.warn('[intake socket] disconnected', reason)
    })
  }

  return socket
}

export function resetIntakeSocket() {
  if (socket) {
    socket.removeAllListeners()
    socket.disconnect()
    socket = null
    currentToken = undefined
  }
}
