/// <reference types="chrome" />
declare function require(id: string): unknown
import { flush, installChromeMock, type ChromeMock } from './chrome-mock'

/**
 * Dry run 2026-10-16: one launch must cover the whole IRCC application. After
 * a run the server renews the approval; when the applicant moves the bound
 * portal tab to another page, the panel starts that page's run with it.
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

const starts = (s: FakeSocket) => s.emit.mock.calls.filter(([ev]) => ev === 'portal-fill:start')

async function runOnePage(sock: FakeSocket, executionId: string) {
  const ack = jest.fn()
  await sock.handlers['portal-fill:stage']({ protocol: PROTOCOL, kind: 'stage', executionId, stage: 'started' }, ack)
  expect(ack).toHaveBeenCalledWith({ bound: true, executionId })
  await sock.handlers['portal-fill:stage']({ protocol: PROTOCOL, kind: 'stage', executionId, stage: 'completed' }, jest.fn())
}

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

describe('one launch follows the applicant through the portal', () => {
  it('fills the next page with the renewed approval when the bound tab moves', async () => {
    const { sock, mock, url } = await load()
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    expect(starts(sock)).toEqual([['portal-fill:start', { readbackToken: 'approval' }]])
    await runOnePage(sock, 'e1')
    sock.handlers['portal-fill:renewed']({ protocol: PROTOCOL, readbackToken: 'renewed-1' })

    url.v = IRCC('/bio-data')
    for (const fn of mock.listeners.tabsUpdated) fn(7, { url: url.v }, { id: 7, url: url.v })
    await jest.advanceTimersByTimeAsync(3000)

    expect(starts(sock)).toHaveLength(2)
    expect(starts(sock)[1]).toEqual(['portal-fill:start', { readbackToken: 'renewed-1' }])
  })

  it('does not refill the same page or follow another tab', async () => {
    const { sock, mock, url } = await load()
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    await runOnePage(sock, 'e1')
    sock.handlers['portal-fill:renewed']({ protocol: PROTOCOL, readbackToken: 'renewed-1' })

    for (const fn of mock.listeners.tabsUpdated) fn(7, { status: 'complete' }, { id: 7, url: url.v })
    for (const fn of mock.listeners.tabsUpdated) fn(9, { url: IRCC('/bio-data') }, { id: 9, url: IRCC('/bio-data') })
    await jest.advanceTimersByTimeAsync(3000)
    expect(starts(sock)).toHaveLength(1)
  })

  it('spends each renewed approval once', async () => {
    const { sock, mock, url } = await load()
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    await runOnePage(sock, 'e1')
    sock.handlers['portal-fill:renewed']({ protocol: PROTOCOL, readbackToken: 'renewed-1' })

    url.v = IRCC('/bio-data')
    for (const fn of mock.listeners.tabsUpdated) fn(7, { url: url.v }, { id: 7, url: url.v })
    await jest.advanceTimersByTimeAsync(3000)
    // No renewal arrived for the second page: moving again starts nothing.
    url.v = IRCC('/nationality')
    for (const fn of mock.listeners.tabsUpdated) fn(7, { url: url.v }, { id: 7, url: url.v })
    await jest.advanceTimersByTimeAsync(3000)
    expect(starts(sock)).toHaveLength(2)
  })

  it('a page reached while a run was busy is filled once that run ends (live 2026-10-18)', async () => {
    const { sock, mock, url } = await load(IRCC('/group-questions'))
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    const ack = jest.fn()
    await sock.handlers['portal-fill:stage']({ protocol: PROTOCOL, kind: 'stage', executionId: 'e1', stage: 'started' }, ack)
    // IRCC moves on to /purpose while the run on the page before is still bound.
    url.v = IRCC('/purpose')
    for (const fn of mock.listeners.tabsUpdated) fn(7, { url: url.v }, { id: 7, url: url.v })
    await jest.advanceTimersByTimeAsync(3000)
    expect(starts(sock)).toHaveLength(1)
    await sock.handlers['portal-fill:stage']({ protocol: PROTOCOL, kind: 'stage', executionId: 'e1', stage: 'completed' }, jest.fn())
    sock.handlers['portal-fill:renewed']({ protocol: PROTOCOL, readbackToken: 'renewed-1' })
    await jest.advanceTimersByTimeAsync(3000)
    expect(starts(sock)).toHaveLength(2)
    expect(starts(sock)[1]).toEqual(['portal-fill:start', { readbackToken: 'renewed-1' }])
  })

  it('the catch-up never refills the page just filled', async () => {
    const { sock } = await load()
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    await runOnePage(sock, 'e1')
    sock.handlers['portal-fill:renewed']({ protocol: PROTOCOL, readbackToken: 'renewed-1' })
    await jest.advanceTimersByTimeAsync(3000)
    expect(starts(sock)).toHaveLength(1)
  })

  it('never follows without a renewal from the server', async () => {
    const { sock, mock, url } = await load()
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    await runOnePage(sock, 'e1')
    url.v = IRCC('/bio-data')
    for (const fn of mock.listeners.tabsUpdated) fn(7, { url: url.v }, { id: 7, url: url.v })
    await jest.advanceTimersByTimeAsync(3000)
    expect(starts(sock)).toHaveLength(1)
  })
})

it('takes the rotated resume token from a renewal', async () => {
  const { sock } = await load()
  sock.handlers['automation:ready']({ resumeToken: 'r1' })
  await runOnePage(sock, 'e1')
  sock.handlers['portal-fill:renewed']({ protocol: PROTOCOL, readbackToken: 'renewed-1', resumeToken: 'r2' })
  // The next reconnect presents the rotated token.
  let auth: Record<string, string> = {}
  sock.opts.auth((d: Record<string, string>) => (auth = d))
  expect(auth).toEqual({ resumeToken: 'r2' })
})

describe('signed out, error page, account home (dry run 2026-10-17)', () => {
  const SIGNIN = 'https://portal-portail.apps.cic.gc.ca/signin?lang=en'
  const move = (mock: ChromeMock, url: { v: string }, to: string) => {
    url.v = to
    for (const fn of mock.listeners.tabsUpdated) fn(7, { url: to }, { id: 7, url: to })
  }

  it('keeps the launch through a sign-out and fills the form page the applicant comes back to', async () => {
    const { sock, mock, url } = await load()
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    await runOnePage(sock, 'e1')
    sock.handlers['portal-fill:renewed']({ protocol: PROTOCOL, readbackToken: 'renewed-1' })

    move(mock, url, SIGNIN)
    await jest.advanceTimersByTimeAsync(3000)
    expect(starts(sock)).toHaveLength(1)
    expect(document.getElementById('status')!.textContent).toMatch(/Sign in to your IRCC account/)

    move(mock, url, 'https://tr-rt.apps.cic.gc.ca/error?lang=en')
    await jest.advanceTimersByTimeAsync(3000)
    expect(starts(sock)).toHaveLength(1)
    expect(document.getElementById('status')!.textContent).toMatch(/error page/)

    // Back on the SAME page as before the sign-out: it fills again.
    move(mock, url, IRCC('/purpose'))
    await jest.advanceTimersByTimeAsync(3000)
    expect(starts(sock)).toHaveLength(2)
    expect(starts(sock)[1]).toEqual(['portal-fill:start', { readbackToken: 'renewed-1' }])
  })

  it('never fills fees, declaration or payment pages', async () => {
    const { sock, mock, url } = await load()
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    await runOnePage(sock, 'e1')
    sock.handlers['portal-fill:renewed']({ protocol: PROTOCOL, readbackToken: 'renewed-1' })
    move(mock, url, 'https://tr-rt.apps.cic.gc.ca/fees?lang=en')
    await jest.advanceTimersByTimeAsync(3000)
    expect(starts(sock)).toHaveLength(1)
    expect(document.getElementById('status')!.textContent).toMatch(/fees, the declaration, your signature or payment/)
  })

  it('binds only once the form page has loaded (live 2026-10-17: "Could not read the portal page")', async () => {
    const { sock, url, mock } = await load(SIGNIN)
    let status = 'complete'
    mock.chrome.tabs.query = jest.fn(async () => [{ id: 7, active: true, url: url.v, status }])
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    const ack = jest.fn()
    const started = sock.handlers['portal-fill:stage'](
      { protocol: PROTOCOL, kind: 'stage', executionId: 'e1', stage: 'started' },
      ack,
    ) as Promise<void>
    await jest.advanceTimersByTimeAsync(1000)
    url.v = IRCC('/doc-upload')
    status = 'loading'
    await jest.advanceTimersByTimeAsync(5000)
    expect(ack).not.toHaveBeenCalled()
    status = 'complete'
    await jest.advanceTimersByTimeAsync(1000)
    expect(ack).not.toHaveBeenCalled() // settling
    await jest.advanceTimersByTimeAsync(3000)
    await started
    expect(ack).toHaveBeenCalledWith({ bound: true, executionId: 'e1' })
  })

  it('waits long enough to sign in again: still waiting after two minutes', async () => {
    const { sock, url } = await load(SIGNIN)
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    const ack = jest.fn()
    const started = sock.handlers['portal-fill:stage'](
      { protocol: PROTOCOL, kind: 'stage', executionId: 'e1', stage: 'started' },
      ack,
    ) as Promise<void>
    await jest.advanceTimersByTimeAsync(120_000)
    expect(ack).not.toHaveBeenCalled()
    url.v = IRCC('/doc-upload')
    await jest.advanceTimersByTimeAsync(4000)
    await started
    expect(ack).toHaveBeenCalledWith({ bound: true, executionId: 'e1' })
  })

  it('a launch with the portal on the sign-in page waits, then binds once a form page is open', async () => {
    const { sock, url } = await load(SIGNIN)
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    const ack = jest.fn()
    const started = sock.handlers['portal-fill:stage'](
      { protocol: PROTOCOL, kind: 'stage', executionId: 'e1', stage: 'started' },
      ack,
    ) as Promise<void>
    await jest.advanceTimersByTimeAsync(1000)
    expect(document.getElementById('status')!.textContent).toMatch(/Sign in to your IRCC account/)
    expect(ack).not.toHaveBeenCalled()
    url.v = IRCC('/purpose')
    await jest.advanceTimersByTimeAsync(4000)
    await started
    expect(ack).toHaveBeenCalledWith({ bound: true, executionId: 'e1' })
  })

  it('a launch that never reaches a form page says to sign in and launch again', async () => {
    const { sock } = await load(SIGNIN)
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    const ack = jest.fn()
    const started = sock.handlers['portal-fill:stage'](
      { protocol: PROTOCOL, kind: 'stage', executionId: 'e1', stage: 'started' },
      ack,
    ) as Promise<void>
    await jest.advanceTimersByTimeAsync(175_000)
    await started
    expect(ack).toHaveBeenCalledWith({ bound: false })
    expect(document.getElementById('error')!.textContent).toMatch(/Launch assistant/)
    // The server's own failure that follows does not replace that guidance.
    await sock.handlers['portal-fill:stage'](
      { protocol: PROTOCOL, kind: 'stage', executionId: 'e1', stage: 'failed', reason: 'transport_error' },
      jest.fn(),
    )
    sock.handlers['automation:error']({ message: 'The extension did not bind a portal tab. Open the portal tab and retry.' })
    expect(document.getElementById('error')!.textContent).toMatch(/Launch assistant/)
    expect(document.getElementById('status')!.textContent).not.toMatch(/unverified/)
  })
})

describe('documents still required on IRCC /doc-upload', () => {
  it('names each required document that is not uploaded, and says a form to sign must be signed', async () => {
    const { sock } = await load(IRCC('/doc-upload'), [
      { name: 'Passport or travel document', uploaded: true },
      { name: 'Use of representative IMM5476', uploaded: false },
    ])
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    await runOnePage(sock, 'e1')
    const el = document.getElementById('uploads')!
    expect(el.textContent).toMatch(/Still required before IRCC lets you pay: Use of representative IMM5476/)
    expect(el.textContent).toMatch(/must be signed first/)
    expect(el.textContent).not.toMatch(/Passport/)
  })

  it('also on the progressive completion IRCC /doc-upload sends (live 2026-10-17)', async () => {
    const { sock } = await load(IRCC('/doc-upload'), [{ name: 'Use of representative IMM5476', uploaded: false }])
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    const ack = jest.fn()
    await sock.handlers['portal-fill:stage']({ protocol: PROTOCOL, kind: 'stage', executionId: 'e1', stage: 'started' }, ack)
    await sock.handlers['portal-fill:stage'](
      { protocol: PROTOCOL, kind: 'stage', executionId: 'e1', stage: 'completed', remaining: [] },
      jest.fn(),
    )
    expect(document.getElementById('uploads')!.textContent).toMatch(/Still required before IRCC lets you pay: Use of representative IMM5476/)
  })

  it('says when every required document is in', async () => {
    const { sock } = await load(IRCC('/doc-upload'), [{ name: 'Passport or travel document', uploaded: true }])
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    await runOnePage(sock, 'e1')
    expect(document.getElementById('uploads')!.textContent).toMatch(/Every required document is uploaded/)
  })

  it('asks nothing on other pages', async () => {
    const { sock, mock } = await load()
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    await runOnePage(sock, 'e1')
    const asked = (mock.chrome.runtime.sendMessage as jest.Mock).mock.calls.map(([m]) => m.type)
    expect(asked).not.toContain('pf-upload-status')
  })
})


describe("IRCC's session timeout warning (live 2026-10-18)", () => {
  it('the panel tells the applicant to continue the session, and clears it after', async () => {
    const { sock, mock } = await load()
    sock.handlers['automation:ready']({ resumeToken: 'r1' })
    await runOnePage(sock, 'e1')
    const send = (shown: boolean, tabId: number) =>
      mock.listeners.onMessage.forEach((fn) => fn({ type: 'portal-session-warning', shown }, { id: 'ext', tab: { id: tabId } }, () => undefined))
    const el = document.getElementById('sessionWarning')!
    send(true, 9) // another tab: ignored
    expect(el.style.display).toBe('none')
    send(true, 7)
    expect(el.style.display).toBe('block')
    expect(el.textContent).toMatch(/Continue session/)
    send(false, 7)
    expect(el.style.display).toBe('none')
  })
})
