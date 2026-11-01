/// <reference types="chrome" />
declare function require(id: string): unknown
import { flush, installChromeMock } from './chrome-mock'

/**
 * Live 2026-10-19: the API restarted for a deploy in the middle of an eTA
 * fill. The socket resumed, but the run's approval was spent and no renewal
 * came, so the panel could only say "start again from the VisaAI submission
 * page". Now it offers "Continue filling", reusing the cut-off run's approval
 * on the applicant's click — never automatically.
 */

type Handler = (...a: any[]) => unknown
interface FakeSocket {
  handlers: Record<string, Handler>
  emit: jest.Mock
  on: (ev: string, h: Handler) => void
  disconnect: jest.Mock
  connected: boolean
}
let sockets: FakeSocket[] = []
jest.mock('socket.io-client', () => ({
  io: () => {
    const sock: FakeSocket = {
      handlers: {},
      emit: jest.fn(),
      on(ev, h) {
        this.handlers[ev] = h
      },
      disconnect: jest.fn(),
      connected: true,
    }
    sockets.push(sock)
    return sock
  },
}))

const ETA = 'https://eta.onlineservices-servicesenligne.apps.cic.gc.ca/eta/welcome?lang=en#/application'
const PROTOCOL = 2

async function load(): Promise<FakeSocket> {
  sockets = []
  document.body.innerHTML = `
    <div id="connect"><input id="apiUrl" /><input id="token" /><button id="connectBtn"></button></div>
    <div id="session"><div id="steps"></div></div><div id="next"></div>
    <button id="fillAgain" style="display:none">Fill newly shown questions</button>
    <div id="status"></div><div id="error"></div>`
  const mock = installChromeMock({
    pendingSession: { token: 'connect-token', apiUrl: 'https://api.visaai.co', readbackToken: 'approval', receivedAt: Date.now() },
  })
  mock.chrome.tabs.query = jest.fn(async () => [{ id: 7, active: true, url: ETA }])
  mock.chrome.tabs.get = jest.fn(async (id: number) => ({ id, url: ETA }))
  mock.chrome.runtime.sendMessage = jest.fn(async (m: { type: string }) => (m.type === 'pf-bind-session' ? { ok: true } : undefined))
  jest.isolateModules(() => {
    require('../src/sidepanel')
  })
  await flush(10)
  return sockets[0]
}

const starts = (s: FakeSocket) => s.emit.mock.calls.filter(([ev]) => ev === 'portal-fill:start')
const button = () => document.getElementById('fillAgain') as HTMLButtonElement
const status = () => document.getElementById('status')!.textContent ?? ''
const error = () => document.getElementById('error')!.textContent ?? ''

describe('a fill cut off by a dropped connection', () => {
  it('offers "Continue filling" after the reconnect and reuses the approval only on click', async () => {
    const sock = await load()
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    expect(starts(sock)).toEqual([['portal-fill:start', { readbackToken: 'approval' }]])
    await sock.handlers['portal-fill:stage']({ protocol: PROTOCOL, kind: 'stage', executionId: 'e1', stage: 'started' }, jest.fn())

    // Mid-run: the server restarts.
    sock.handlers['disconnect']('transport close')
    sock.handlers['automation:ready']({ resumeToken: 'r2', resumed: true })

    expect(starts(sock)).toHaveLength(1) // nothing restarts by itself
    expect(status()).toMatch(/Continue filling/)
    expect(error()).not.toMatch(/start the fill again/)
    expect(button().style.display).toBe('block')
    expect(button().textContent).toBe('Continue filling')

    button().click()
    expect(starts(sock)).toHaveLength(2)
    expect(starts(sock)[1]).toEqual(['portal-fill:start', { readbackToken: 'approval' }])
    expect(button().textContent).toBe('Fill newly shown questions')
  })

  it('a drop between runs (no fill in progress) does not offer to continue', async () => {
    const sock = await load()
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    await sock.handlers['portal-fill:stage']({ protocol: PROTOCOL, kind: 'stage', executionId: 'e1', stage: 'started' }, jest.fn())
    await sock.handlers['portal-fill:stage'](
      { protocol: PROTOCOL, kind: 'stage', executionId: 'e1', stage: 'completed', nextPage: null, remaining: [] },
      jest.fn(),
    )
    sock.handlers['disconnect']('transport close')
    sock.handlers['automation:ready']({ resumeToken: 'r2', resumed: true })
    expect(button().textContent).not.toBe('Continue filling')
    expect(starts(sock)).toHaveLength(1)
  })

  it('the approval is offered once: a second drop after continuing needs a new launch', async () => {
    const sock = await load()
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    await sock.handlers['portal-fill:stage']({ protocol: PROTOCOL, kind: 'stage', executionId: 'e1', stage: 'started' }, jest.fn())
    sock.handlers['disconnect']('transport close')
    sock.handlers['automation:ready']({ resumeToken: 'r2', resumed: true })
    button().click()
    button().click()
    expect(starts(sock)).toHaveLength(2)
  })
})
