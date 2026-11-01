/// <reference types="chrome" />
declare function require(id: string): unknown
import { flush, installChromeMock, type ChromeMock } from './chrome-mock'

/**
 * Auto-advance (owner decision 2026-10-31): opt-in, OFF by default, IRCC
 * Portal (tr-rt) sessions only. After a page fills with every write verified,
 * the panel asks the page for a read-only check and presses "Save and
 * continue" only when nothing is left, nothing is wrong and nothing moves.
 * Any doubt pauses it and says why.
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

const IRCC = (p: string) => `https://tr-rt.apps.cic.gc.ca${p}?lang=en`
const PROTOCOL = 2
const CLEAN = { settled: true, rows: 0, errors: [], required: [], sessionWarning: false }

interface Loaded {
  sock: FakeSocket
  mock: ChromeMock
  url: { v: string }
  check: { v: unknown }
}

async function load(start = IRCC('/bio-data'), portalId = 'ircc'): Promise<Loaded> {
  sockets = []
  document.body.innerHTML = `
    <div id="connect"><input id="apiUrl" /><input id="token" /><button id="connectBtn"></button></div>
    <div id="session"><div id="steps"></div></div><div id="next"></div>
    <div id="autoAdvanceWrap" style="display:none"><input type="checkbox" id="autoAdvance" /><div id="autoAdvanceNote"></div></div>
    <div id="status"></div><div id="error"></div><div id="uploads"></div><div id="stale"></div><div id="sessionWarning" style="display:none"></div>`
  const mock = installChromeMock({
    pendingSession: { token: 'connect-token', apiUrl: 'https://api.visaai.co', readbackToken: 'approval', receivedAt: Date.now() },
  })
  const url = { v: start }
  const check = { v: CLEAN as unknown }
  mock.chrome.tabs.query = jest.fn(async () => [{ id: 7, active: true, url: url.v }])
  mock.chrome.tabs.get = jest.fn(async (id: number) => ({ id, url: url.v }))
  mock.chrome.tabs.sendMessage = jest.fn(async (_id: number, m: { type: string }) =>
    m.type === 'advance-check' ? check.v : m.type === 'advance-press' ? { pressed: true } : undefined,
  ) as never
  mock.chrome.runtime.sendMessage = jest.fn(async (m: { type: string }) =>
    m.type === 'pf-bind-session' ? { ok: true } : undefined,
  )
  jest.isolateModules(() => {
    require('../src/sidepanel')
  })
  await flush(10)
  const sock = sockets[0]
  sock.handlers['automation:ready']({ resumeToken: 'r1', portalId })
  const ack = jest.fn()
  await sock.handlers['portal-fill:stage']({ protocol: PROTOCOL, kind: 'stage', executionId: 'e1', stage: 'started' }, ack)
  expect(ack).toHaveBeenCalledWith({ bound: true, executionId: 'e1' })
  return { sock, mock, url, check }
}

const box = () => document.getElementById('autoAdvance') as HTMLInputElement
const note = () => document.getElementById('autoAdvanceNote')!.textContent ?? ''
function turnOn() {
  box().checked = true
  box().dispatchEvent(new Event('change'))
}
const sent = (m: ChromeMock, type: string) =>
  (m.chrome.tabs.sendMessage as jest.Mock).mock.calls.filter(([, msg]) => msg?.type === type)
async function complete(sock: FakeSocket, extra: Record<string, unknown> = { left: [] }) {
  await sock.handlers['portal-fill:stage'](
    { protocol: PROTOCOL, kind: 'stage', executionId: 'e1', stage: 'completed', ...extra },
    jest.fn(),
  )
  await flush(20)
}

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

describe('auto-advance', () => {
  it('is offered on an IRCC Portal session, OFF by default: nothing is pressed', async () => {
    const { sock, mock } = await load()
    expect(document.getElementById('autoAdvanceWrap')!.style.display).toBe('block')
    expect(box().checked).toBe(false)
    await complete(sock)
    expect(sent(mock, 'advance-check')).toHaveLength(0)
    expect(sent(mock, 'advance-press')).toHaveLength(0)
  })

  it('is not offered, and cannot be turned on, for eTA / eapp / PR sessions', async () => {
    for (const [portal, at] of [
      ['ircc-eta', 'https://eta.onlineservices-servicesenligne.apps.cic.gc.ca/eta/applicant'],
      ['ircc-study', 'https://onlineservices-servicesenligne.cic.gc.ca/eapp/eapp'],
      ['ircc-pr-family', 'https://prson-srpel.apps.cic.gc.ca/en/application/profile/1'],
    ]) {
      const { sock, mock } = await load(at, portal)
      expect(document.getElementById('autoAdvanceWrap')!.style.display).toBe('none')
      turnOn()
      expect(box().checked).toBe(false)
      await complete(sock)
      expect(sent(mock, 'advance-press')).toHaveLength(0)
    }
  })

  it('on a clean, fully verified page: checks, then presses Save and continue once', async () => {
    const { sock, mock } = await load()
    turnOn()
    await complete(sock)
    expect(sent(mock, 'advance-check')).toHaveLength(1)
    const press = sent(mock, 'advance-press')
    expect(press).toHaveLength(1)
    expect(press[0][0]).toBe(7)
    expect(press[0][1]).toMatchObject({ path: '/bio-data' })
    expect(note()).toMatch(/pressed Save and continue/)
  })

  it('leftovers for this page: stops and says what to fill, nothing pressed', async () => {
    const { sock, mock } = await load()
    turnOn()
    await complete(sock, { left: ['UCI', 'Other names'] })
    expect(sent(mock, 'advance-press')).toHaveLength(0)
    expect(note()).toMatch(/paused: fill these.*UCI; Other names/)
    expect(box().checked).toBe(false)
  })

  it('an older server that does not say what is left: stops', async () => {
    const { sock, mock } = await load()
    turnOn()
    await complete(sock, {})
    expect(sent(mock, 'advance-press')).toHaveLength(0)
    expect(note()).toMatch(/could not confirm/)
  })

  it('IRCC error text, an empty required question, rows not settling or the session warning: stops', async () => {
    for (const c of [
      { ...CLEAN, errors: ['This field is required.'] },
      { ...CLEAN, required: ['Family name'] },
      { ...CLEAN, settled: false },
      { ...CLEAN, sessionWarning: true },
      null,
    ]) {
      const { sock, mock, check } = await load()
      check.v = c
      turnOn()
      await complete(sock)
      expect(sent(mock, 'advance-press')).toHaveLength(0)
      expect(note()).toMatch(/paused/)
    }
  })

  it('never on Summary, documents or an unknown page', async () => {
    for (const p of ['/summary', '/doc-upload', '/something-new']) {
      const { sock, mock } = await load(IRCC(p))
      turnOn()
      await complete(sock)
      expect(sent(mock, 'advance-press')).toHaveLength(0)
      expect(note()).toMatch(p === '/summary' ? /Review the summary yourself; nothing was submitted/ : /paused/)
    }
  })

  it('a failed field stops it', async () => {
    const { sock, mock } = await load()
    turnOn()
    await sock.handlers['portal-fill:stage'](
      { protocol: PROTOCOL, kind: 'stage', executionId: 'e1', stage: 'failed', reason: 'value_mismatch' },
      jest.fn(),
    )
    await flush(10)
    expect(sent(mock, 'advance-press')).toHaveLength(0)
    expect(note()).toMatch(/did not fill and verify/)
  })

  it('a nothing-mapped page stops it', async () => {
    const { sock, mock } = await load()
    turnOn()
    sock.handlers['automation:error']({ message: 'The assistant has no reviewed values for this page. Nothing was filled.' })
    await flush(10)
    expect(sent(mock, 'advance-press')).toHaveLength(0)
    expect(note()).toMatch(/nothing is mapped/)
  })

  it("IRCC's session warning stops it", async () => {
    const { mock } = await load()
    turnOn()
    for (const fn of mock.listeners.onMessage) fn({ type: 'portal-session-warning', shown: true }, { tab: { id: 7 } }, () => undefined)
    expect(box().checked).toBe(false)
    expect(note()).toMatch(/sign you out/)
  })

  it('IRCC did not move on after the press: stops', async () => {
    const { sock } = await load()
    turnOn()
    await complete(sock)
    expect(note()).toMatch(/pressed/)
    await jest.advanceTimersByTimeAsync(15_500)
    expect(note()).toMatch(/did not move on/)
    expect(box().checked).toBe(false)
  })

  it('moving on to the next page keeps it on; reaching Summary stops it', async () => {
    const { sock, mock, url } = await load()
    turnOn()
    await complete(sock)
    sock.handlers['portal-fill:renewed']({ protocol: PROTOCOL, readbackToken: 'renewed-1' })
    url.v = IRCC('/bio-data-travel-docs')
    for (const fn of mock.listeners.tabsUpdated) fn(7, { url: url.v }, { id: 7, url: url.v })
    await jest.advanceTimersByTimeAsync(16_000)
    expect(box().checked).toBe(true)
    url.v = IRCC('/summary')
    for (const fn of mock.listeners.tabsUpdated) fn(7, { url: url.v }, { id: 7, url: url.v })
    await flush(5)
    expect(box().checked).toBe(false)
    expect(note()).toMatch(/Review the summary yourself; nothing was submitted/)
  })

  it("IRCC's /application-type info page: nothing pressed, stays on, carries on at the next page (live 2026-10-31)", async () => {
    const { sock, mock, url } = await load(IRCC('/purpose'))
    turnOn()
    await complete(sock)
    expect(sent(mock, 'advance-press')).toHaveLength(1)
    sock.handlers['portal-fill:renewed']({ protocol: PROTOCOL, readbackToken: 'renewed-1' })
    // The renewal catches up on the page open at the time (still /purpose).
    await flush(5)
    url.v = IRCC('/application-type/tourist')
    for (const fn of mock.listeners.tabsUpdated) fn(7, { url: url.v }, { id: 7, url: url.v })
    await flush(5)
    expect(box().checked).toBe(true)
    expect(note()).toMatch(/stays on.*Continue to application/)
    // The server has nothing mapped there.
    sock.handlers['automation:error']({ message: 'The assistant has no reviewed values for this page. Nothing was filled.' })
    await flush(10)
    expect(box().checked).toBe(true)
    // A run that fails there does not turn it off either.
    await sock.handlers['portal-fill:stage'](
      { protocol: PROTOCOL, kind: 'stage', executionId: 'e1', stage: 'failed', reason: 'selector_missing' },
      jest.fn(),
    )
    await flush(10)
    expect(box().checked).toBe(true)
    // Even a completed run there presses nothing.
    await complete(sock)
    expect(sent(mock, 'advance-press')).toHaveLength(1)
    expect(box().checked).toBe(true)
    // The applicant continues: on the next form page it is still on.
    url.v = IRCC('/representative')
    for (const fn of mock.listeners.tabsUpdated) fn(7, { url: url.v }, { id: 7, url: url.v })
    await flush(5)
    expect(box().checked).toBe(true)
    expect(note()).not.toMatch(/paused/)
  })

  it('a no-values page that is NOT the info page still pauses it', async () => {
    const { sock } = await load(IRCC('/bio-data'))
    turnOn()
    sock.handlers['automation:error']({ message: 'The assistant has no reviewed values for this page. Nothing was filled.' })
    await flush(10)
    expect(box().checked).toBe(false)
  })

  it('a new launch starts with it off', async () => {
    const { mock } = await load()
    turnOn()
    expect(box().checked).toBe(true)
    mock.store.pendingSession = { token: 'second', apiUrl: 'https://api.visaai.co', readbackToken: 'a2', receivedAt: Date.now() }
    for (const fn of mock.listeners.storageChanged) fn({ pendingSession: { newValue: mock.store.pendingSession } }, 'local')
    await flush(10)
    expect(box().checked).toBe(false)
  })
})
