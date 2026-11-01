/// <reference types="chrome" />
declare function require(id: string): unknown
import { deliver, flush, installChromeMock } from './chrome-mock'

/**
 * Two questionnaire screens whose controls carry the same generic label but
 * whose question paragraphs differ are BOTH filled: the side panel's "this
 * screen was filled already" check reads the real content script's screen
 * signature (labels, control names, hash of the visible text).
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

const PROTOCOL = 2
const EAPP = 'https://onlineservices-servicesenligne.cic.gc.ca/eapp/eapp'
const screen = (para: string) => `
  <p>${para}</p>
  <label for="answerlist[0]">Yes or no</label>
  <select id="answerlist[0]" name="answerList[0].value"><option value="991">Yes</option><option value="997">No</option></select>`

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

it('two Yes/No screens with identical labels but different paragraphs are both filled; the same one again is not', async () => {
  sockets = []
  document.body.innerHTML = `
    <div id="portal"></div>
    <div id="connect"><input id="apiUrl" /><input id="token" /><button id="connectBtn"></button></div>
    <div id="session"><div id="steps"></div></div><div id="next"></div><button id="fillAgain" style="display:none"></button>
    <div id="status"></div><div id="error"></div><div id="uploads"></div><div id="sessionWarning" style="display:none"></div>`
  const portal = () => document.getElementById('portal')!
  portal().innerHTML = screen('Are you an exchange student?')
  const mock = installChromeMock({
    pendingSession: { token: 'connect-token', apiUrl: 'https://api.visaai.co', readbackToken: 'approval', receivedAt: Date.now() },
  })
  jest.isolateModules(() => {
    require('../src/content')
  })
  const content = [...mock.listeners.onMessage]
  mock.chrome.tabs.query = jest.fn(async () => [{ id: 7, active: true, url: EAPP }])
  mock.chrome.tabs.get = jest.fn(async (id: number) => ({ id, url: EAPP }))
  mock.chrome.tabs.sendMessage = jest.fn((_id: number, m: unknown) => deliver(content, m, undefined, 500)) as never
  mock.chrome.runtime.sendMessage = jest.fn(async (m: { type: string }) => (m.type === 'pf-bind-session' ? { ok: true } : undefined))
  jest.isolateModules(() => {
    require('../src/sidepanel')
  })
  await flush(10)
  const sock = sockets[0]
  const starts = () => sock.emit.mock.calls.filter(([ev]) => ev === 'portal-fill:start')
  const run = async (id: string) => {
    await sock.handlers['portal-fill:stage']({ protocol: PROTOCOL, kind: 'stage', executionId: id, stage: 'started' }, jest.fn())
    await sock.handlers['portal-fill:stage'](
      { protocol: PROTOCOL, kind: 'stage', executionId: id, stage: 'completed', remaining: ['x'] },
      jest.fn(),
    )
  }
  const reload = async () => {
    for (const fn of mock.listeners.tabsUpdated) fn(7, { status: 'loading', url: EAPP }, { id: 7, url: EAPP })
    for (const fn of mock.listeners.tabsUpdated) fn(7, { status: 'complete' }, { id: 7, url: EAPP })
    await jest.advanceTimersByTimeAsync(3000)
  }

  sock.handlers['automation:ready']({ resumeToken: 'r1' })
  await flush(10)
  await run('e1')
  sock.handlers['portal-fill:renewed']({ protocol: PROTOCOL, readbackToken: 'renewed-1' })

  // Next screen: same label, different question paragraph → filled.
  portal().innerHTML = screen('Is work an essential component of your studies?')
  await reload()
  expect(starts()).toHaveLength(2)
  await run('e2')
  sock.handlers['portal-fill:renewed']({ protocol: PROTOCOL, readbackToken: 'renewed-2' })

  // That screen again (an error / reload): not filled again.
  await reload()
  expect(starts()).toHaveLength(2)
  expect(document.getElementById('status')?.textContent).toMatch(/filled already/)
})
