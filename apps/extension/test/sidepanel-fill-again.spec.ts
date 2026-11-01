/// <reference types="chrome" />
declare function require(id: string): unknown
import { flush, installChromeMock } from './chrome-mock'

/**
 * The eTA form never changes its path, so moving to "the next page" cannot
 * start the next run. The panel lists the reviewed answers whose questions are
 * not on the page yet, and the applicant — after answering or pressing the
 * form's own Next — asks for them with one click. The panel never presses
 * anything on the portal.
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
    <button id="fillAgain" style="display:none"></button>
    <div id="status"></div><div id="error"></div>`
  const mock = installChromeMock({
    pendingSession: {
      token: 'connect-token',
      apiUrl: 'https://api.visaai.co',
      readbackToken: 'approval',
      receivedAt: Date.now(),
    },
  })
  mock.chrome.tabs.query = jest.fn(async () => [{ id: 7, active: true, url: ETA }])
  mock.chrome.tabs.get = jest.fn(async (id: number) => ({ id, url: ETA }))
  mock.chrome.runtime.sendMessage = jest.fn(async (m: { type: string }) =>
    m.type === 'pf-bind-session' ? { ok: true } : undefined,
  )
  jest.isolateModules(() => {
    require('../src/sidepanel')
  })
  await flush(10)
  return sockets[0]
}

const starts = (s: FakeSocket) => s.emit.mock.calls.filter(([ev]) => ev === 'portal-fill:start')
const button = () => document.getElementById('fillAgain') as HTMLButtonElement

async function runOnce(sock: FakeSocket, executionId: string, remaining?: string[]) {
  await sock.handlers['portal-fill:stage']({ protocol: PROTOCOL, kind: 'stage', executionId, stage: 'started' }, jest.fn())
  await sock.handlers['portal-fill:stage'](
    { protocol: PROTOCOL, kind: 'stage', executionId, stage: 'completed', nextPage: null, ...(remaining ? { remaining } : {}) },
    jest.fn(),
  )
}

describe('a single page revealed step by step (eTA)', () => {
  it('lists what is not on the page yet and fills it on request with the renewed approval', async () => {
    const sock = await load()
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    await runOnce(sock, 'e1', ['Passport number', 'Date of birth'])
    sock.handlers['portal-fill:renewed']({ protocol: PROTOCOL, readbackToken: 'renewed-1' })

    expect(document.getElementById('next')!.textContent).toMatch(/Passport number/)
    expect(document.getElementById('next')!.textContent).toMatch(/Date of birth/)
    expect(button().style.display).not.toBe('none')

    button().click()
    expect(starts(sock)).toHaveLength(2)
    expect(starts(sock)[1]).toEqual(['portal-fill:start', { readbackToken: 'renewed-1' }])
  })

  it('spends the approval once: a second click before the next renewal starts nothing', async () => {
    const sock = await load()
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    await runOnce(sock, 'e1', ['Passport number'])
    sock.handlers['portal-fill:renewed']({ protocol: PROTOCOL, readbackToken: 'renewed-1' })
    button().click()
    button().click()
    expect(starts(sock)).toHaveLength(2)
  })

  it('with nothing left, says so and offers no further fill', async () => {
    const sock = await load()
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    await runOnce(sock, 'e1', [])
    expect(button().style.display).toBe('none')
    expect(document.getElementById('next')!.textContent).toMatch(/declaration/i)
  })

  it('a multi-page portal run (no remaining list) shows no fill-again button', async () => {
    const sock = await load()
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    await runOnce(sock, 'e1')
    expect(button().style.display).toBe('none')
  })

  it('after the server ends the session (laptop slept past the resume window), says to launch again instead of "already running"', async () => {
    const sock = await load()
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    await runOnce(sock, 'e1', ['Passport number'])
    sock.handlers['portal-fill:renewed']({ protocol: PROTOCOL, readbackToken: 'renewed-1' })
    expect(button().style.display).not.toBe('none')

    // The resumed handshake is refused, then the server closes the socket.
    sock.handlers['automation:error']({
      message: 'Session can no longer be resumed. Start again from the VisaAI submission page.',
    })
    sock.connected = false
    sock.handlers['disconnect']('io server disconnect')

    expect(document.getElementById('error')!.textContent).toMatch(/Launch assistant/)
    expect(document.getElementById('error')!.textContent).not.toMatch(/already running/)
    expect(document.getElementById('status')!.textContent).not.toMatch(/Authenticating/)
    expect(button().style.display).toBe('none')
  })

  it('a fill click on a socket that silently dropped tells the applicant to launch again and starts nothing', async () => {
    const sock = await load()
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    await runOnce(sock, 'e1', ['Passport number'])
    sock.handlers['portal-fill:renewed']({ protocol: PROTOCOL, readbackToken: 'renewed-1' })
    sock.connected = false
    button().click()
    expect(starts(sock)).toHaveLength(1)
    expect(document.getElementById('error')!.textContent).toMatch(/Launch assistant/)
    expect(document.getElementById('error')!.textContent).not.toMatch(/already running/)
  })

  it('an answer filled on an earlier pass and since hidden by the form is not "not on the form yet"', async () => {
    const sock = await load()
    ;(globalThis as any).chrome.runtime.sendMessage = jest.fn(async (m: { type: string; command?: any }) =>
      m.type === 'pf-bind-session'
        ? { ok: true }
        : m.type === 'pf-execute-field'
          ? { protocol: PROTOCOL, kind: 'field_result', executionId: m.command.executionId, fieldKey: m.command.fieldKey, outcome: 'verified', selectorFound: true }
          : undefined,
    )
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    await sock.handlers['portal-fill:stage']({ protocol: PROTOCOL, kind: 'stage', executionId: 'e1', stage: 'started' }, jest.fn())
    await sock.handlers['portal-fill:write'](
      { protocol: PROTOCOL, kind: 'write', executionId: 'e1', fieldKey: 'applying_on_behalf', label: 'Applying on behalf of someone', op: 'select' },
      jest.fn(),
    )
    await sock.handlers['portal-fill:stage'](
      { protocol: PROTOCOL, kind: 'stage', executionId: 'e1', stage: 'completed', nextPage: null, remaining: ['Passport number'] },
      jest.fn(),
    )
    sock.handlers['portal-fill:renewed']({ protocol: PROTOCOL, readbackToken: 'renewed-1' })
    button().click()
    // Second pass: the first question is hidden now, so the server lists it.
    await runOnce(sock, 'e2', ['Applying on behalf of someone'])
    expect(document.getElementById('next')!.textContent).not.toMatch(/Applying on behalf/)
    expect(button().style.display).toBe('none')
  })
})
