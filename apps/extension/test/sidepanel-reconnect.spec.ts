/// <reference types="chrome" />
declare function require(id: string): unknown
import { flush, installChromeMock } from './chrome-mock'

/**
 * REVIEW_HANDOFF item 60, client side. The connect token is single-use, so the
 * socket's automatic reconnect must present the resume token the server issued
 * on `automation:ready` — and a reconnect must never replay the fill approval.
 */

type Handler = (...a: any[]) => unknown
interface FakeSocket {
  handlers: Record<string, Handler>
  emit: jest.Mock
  on: (ev: string, h: Handler) => void
  disconnect: jest.Mock
}
let sockets: { url: string; opts: any; sock: FakeSocket }[] = []
jest.mock('socket.io-client', () => ({
  io: (url: string, opts: any) => {
    const sock: FakeSocket = {
      handlers: {},
      emit: jest.fn(),
      on(ev, h) {
        this.handlers[ev] = h
      },
      disconnect: jest.fn(),
    }
    sockets.push({ url, opts, sock })
    return sock
  },
}))

function authFor(opts: any): Record<string, string> {
  let out: Record<string, string> = {}
  opts.auth((d: Record<string, string>) => (out = d))
  return out
}

async function load() {
  sockets = []
  document.body.innerHTML = `
    <div id="connect"><input id="apiUrl" /><input id="token" /><button id="connectBtn"></button></div>
    <div id="session"><div id="steps"></div></div>
    <div id="status"></div><div id="error"></div>`
  installChromeMock({
    pendingSession: {
      token: 'connect-token',
      apiUrl: 'https://api.visaai.co',
      readbackToken: 'approval',
      receivedAt: Date.now(),
    },
  })
  jest.isolateModules(() => {
    require('../src/sidepanel')
  })
  await flush(10)
  expect(sockets).toHaveLength(1)
  return sockets[0]
}

describe('60 — side panel reconnect', () => {
  it('presents the connect token first, then the latest resume token on every reconnect', async () => {
    const { opts, sock } = await load()
    expect(authFor(opts)).toEqual({ token: 'connect-token' })

    sock.handlers['automation:ready']({ sessionId: 's1', resumeToken: 'r1', resumed: false })
    expect(authFor(opts)).toEqual({ resumeToken: 'r1' })

    sock.handlers['disconnect']('transport close')
    expect(document.getElementById('status')!.textContent).toMatch(/reconnecting/i)

    sock.handlers['automation:ready']({ sessionId: 's1', resumeToken: 'r2', resumed: true })
    expect(authFor(opts)).toEqual({ resumeToken: 'r2' })
  })

  it('spends the approval once: a resumed connection does not restart the fill', async () => {
    const { sock } = await load()
    sock.handlers['automation:ready']({ resumeToken: 'r1', resumed: false })
    const starts = () =>
      sock.emit.mock.calls.filter(([ev]) => ev === 'portal-fill:start')
    expect(starts()).toEqual([['portal-fill:start', { readbackToken: 'approval' }]])

    sock.handlers['disconnect']('transport close')
    sock.handlers['automation:ready']({ resumeToken: 'r2', resumed: true })
    expect(starts()).toHaveLength(1)
    expect(document.getElementById('status')!.textContent).toBe('Reconnected.')
    expect(document.getElementById('error')!.textContent).toMatch(/fill was stopped/)
  })

  it('falls back to the connect token shape only when the server issued no resume token', async () => {
    const { opts, sock } = await load()
    sock.handlers['automation:ready']({ resumeToken: null, resumed: false })
    expect(authFor(opts)).toEqual({ token: 'connect-token' })
    sock.handlers['disconnect']('transport close')
    // Nothing to resume with — no misleading "reconnecting" status.
    expect(document.getElementById('status')!.textContent).not.toMatch(/reconnecting/i)
  })
})
