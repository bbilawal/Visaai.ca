/// <reference types="chrome" />
declare function require(id: string): unknown
import { flush, installChromeMock, type ChromeMock } from './chrome-mock'

/**
 * Live 2026-10-30 (0.1.55): a visitor-visa launch on the study eapp review page.
 * The panel must say "wrong portal", never the study text, and fill nothing.
 *
 */

type Handler = (...a: any[]) => unknown
interface FakeSocket {
  handlers: Record<string, Handler>
  emit: jest.Mock
  on: (ev: string, h: Handler) => void
  disconnect: jest.Mock
  connected: boolean
  opts?: any
}
let sockets: FakeSocket[] = []
jest.mock('socket.io-client', () => ({
  io: (_url: string, opts: any) => {
    const sock: FakeSocket = {
      opts,
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

const IRCC = (p: string) => `https://tr-rt.apps.cic.gc.ca${p}?lang=en`
const PROTOCOL = 2

async function load(
  start: string = IRCC('/purpose'),
  uploads: unknown[] = [],
): Promise<{ sock: FakeSocket; mock: ChromeMock; url: { v: string } }> {
  sockets = []
  document.body.innerHTML = `
    <div id="connect"><input id="apiUrl" /><input id="token" /><button id="connectBtn"></button></div>
    <div id="session"><div id="steps"></div></div><div id="next"></div>
    <div id="status"></div><div id="error"></div><div id="uploads"></div><div id="sessionWarning" style="display:none"></div>`
  const mock = installChromeMock({
    pendingSession: {
      token: 'connect-token',
      apiUrl: 'https://api.visaai.co',
      readbackToken: 'approval',
      receivedAt: Date.now(),
    },
  })
  const url = { v: start }
  mock.chrome.tabs.query = jest.fn(async () => [{ id: 7, active: true, url: url.v }])
  mock.chrome.tabs.get = jest.fn(async (id: number) => ({ id, url: url.v }))
  mock.chrome.runtime.sendMessage = jest.fn(async (m: { type: string }) =>
    m.type === 'pf-bind-session' ? { ok: true } : m.type === 'pf-upload-status' ? uploads : undefined,
  )
  jest.isolateModules(() => {
    require('../src/sidepanel')
  })
  await flush(10)
  return { sock: sockets[0], mock, url }
}

const EAPP_REVIEW = 'https://onlineservices-servicesenligne.cic.gc.ca/eapp/comeToCanadaReviewPage'
const binds = (m: ChromeMock) =>
  (m.chrome.runtime.sendMessage as jest.Mock).mock.calls.filter(([msg]) => msg?.type === 'pf-bind-session')

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

describe('session scoped to its portal', () => {
  it('TRV launch with the tab on the study questionnaire review: wrong-portal message, nothing bound', async () => {
    const { sock, mock } = await load(EAPP_REVIEW)
    sock.handlers['automation:ready']({ resumeToken: 'r1', portalId: 'ircc' })
    const ack = jest.fn()
    void sock.handlers['portal-fill:stage']({ protocol: PROTOCOL, kind: 'stage', executionId: 'e1', stage: 'started' }, ack)
    await flush(10)
    const status = document.getElementById('status')!.textContent ?? ''
    expect(status).toMatch(/IRCC Portal/)
    expect(status).toMatch(/portal-portail\.apps\.cic\.gc\.ca/)
    expect(status).not.toMatch(/questionnaire is done/)
    expect(binds(mock)).toHaveLength(0)
  })

  it('a bound TRV tab that moves onto the study questionnaire review shows wrong portal, starts nothing', async () => {
    const { sock, mock, url } = await load(IRCC('/purpose'))
    sock.handlers['automation:ready']({ resumeToken: 'r1', portalId: 'ircc' })
    const ack = jest.fn()
    await sock.handlers['portal-fill:stage']({ protocol: PROTOCOL, kind: 'stage', executionId: 'e1', stage: 'started' }, ack)
    expect(ack).toHaveBeenCalledWith({ bound: true, executionId: 'e1' })
    await sock.handlers['portal-fill:stage']({ protocol: PROTOCOL, kind: 'stage', executionId: 'e1', stage: 'completed' }, jest.fn())
    sock.handlers['portal-fill:renewed']({ protocol: PROTOCOL, readbackToken: 'renewed-1' })
    await flush(5)
    url.v = EAPP_REVIEW
    for (const fn of mock.listeners.tabsUpdated) fn(7, { url: url.v }, { id: 7, url: url.v })
    await jest.advanceTimersByTimeAsync(3000)
    const status = document.getElementById('status')!.textContent ?? ''
    expect(status).toMatch(/IRCC Portal/)
    expect(status).not.toMatch(/questionnaire is done/)
    expect(sock.emit.mock.calls.filter(([ev]) => ev === 'portal-fill:start')).toHaveLength(1)
  })

  it('a study launch on the same page still shows the questionnaire-done text', async () => {
    const { sock } = await load(EAPP_REVIEW)
    sock.handlers['automation:ready']({ resumeToken: 'r1', portalId: 'ircc-study' })
    void sock.handlers['portal-fill:stage']({ protocol: PROTOCOL, kind: 'stage', executionId: 'e1', stage: 'started' }, jest.fn())
    await flush(10)
    expect(document.getElementById('status')!.textContent).toMatch(/questionnaire is done/)
  })
})
