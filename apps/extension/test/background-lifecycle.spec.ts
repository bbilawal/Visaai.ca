/// <reference types="chrome" />
declare function require(id: string): unknown
import { deliver, EXT_ID, flush, installChromeMock, type ChromeMock } from './chrome-mock'
import { PORTAL_FILL_PROTOCOL_VERSION, type PortalFillWriteCommand } from '../src/shared'

/**
 * Background service worker lifecycle (REVIEW_HANDOFF §27.7 items 53, 57, 59).
 *
 *  53 — `pendingSession` holds a base64url readbackToken with the applicant's
 *       mapped values (passport number, DOB, address). Its 5-minute TTL existed
 *       only in the side panel's reader, so a session the user never opened
 *       stayed in chrome.storage.local indefinitely. It must be PURGED: on the
 *       TTL alarm, and whenever the worker starts.
 *  57 — `pfSession` binds a tab id. A tab id is a container, not a page: after
 *       a mid-run navigation the next write lands in whatever document now
 *       occupies it. Navigation or closing the tab must unbind.
 *  59 — onMessage must only act on messages from this extension.
 */

const TTL = 5 * 60 * 1000

function load(storage: Record<string, unknown> = {}): ChromeMock {
  const mock = installChromeMock(storage)
  jest.isolateModules(() => {
    require('../src/background')
  })
  return mock
}

const command = (over: Partial<PortalFillWriteCommand> = {}): PortalFillWriteCommand => ({
  protocol: PORTAL_FILL_PROTOCOL_VERSION,
  kind: 'write',
  executionId: 'exec-1',
  fieldKey: 'passport_number',
  selector: '#passport',
  mappedValue: 'X1234567',
  expectedValueHash: 'h',
  ...over,
})

async function bind(mock: ChromeMock, tabId = 7) {
  const r = await deliver(mock.listeners.onMessage, { type: 'pf-bind-session', executionId: 'exec-1', tabId })
  expect(r).toEqual({ ok: true })
}

afterEach(() => {
  jest.restoreAllMocks()
})

describe('Launch brings the portal tab to the front (live 2026-10-17)', () => {
  it('switches to the IRCC tab in the window Launch was clicked in', async () => {
    const mock = load()
    const update = jest.fn(async () => ({}))
    ;(mock.chrome.tabs as any).update = update
    mock.chrome.tabs.query = jest.fn(async () => [
      { id: 1, url: 'https://visaai.co/submission/x', active: true },
      { id: 2, url: 'https://tr-rt.apps.cic.gc.ca/doc-upload?x=1', active: false },
    ]) as any
    const r = await deliver(
      mock.listeners.onMessageExternal,
      { type: 'session', token: 't', apiUrl: 'https://api.visaai.co', readbackToken: 'rb' },
      { origin: 'https://visaai.co', tab: { id: 1, windowId: 9 } },
    )
    expect(r).toEqual({ ok: true })
    expect(mock.chrome.tabs.query).toHaveBeenCalledWith({ windowId: 9 })
    expect(update).toHaveBeenCalledWith(2, { active: true })
  })

  it("uses the application's pages: a leftover eTA tab is skipped", async () => {
    const mock = load()
    const update = jest.fn(async () => ({}))
    ;(mock.chrome.tabs as any).update = update
    mock.chrome.tabs.query = jest.fn(async () => [
      { id: 1, url: 'https://visaai.co/submission/x', active: true },
      { id: 2, url: 'https://portal-portail.apps.cic.gc.ca/home', lastAccessed: 10 },
      { id: 3, url: 'https://eta.onlineservices-servicesenligne.apps.cic.gc.ca/eta/welcome', lastAccessed: 50 },
    ]) as any
    await deliver(
      mock.listeners.onMessageExternal,
      { type: 'session', token: 't', apiUrl: 'https://api.visaai.co', readbackToken: 'rb', portalPages: ['/purpose', 42, '/doc-upload'] },
      { origin: 'https://visaai.co', tab: { id: 1, windowId: 9 } },
    )
    expect(update).toHaveBeenCalledWith(2, { active: true })
  })
})

describe('Launch opens the side panel from the click (live 2026-10-17)', () => {
  it('opens the panel in the window Launch was clicked in, with no await first', async () => {
    const mock = load()
    const open = jest.fn(async () => undefined)
    ;(mock.chrome.sidePanel as any).open = open
    const r = await deliver(
      mock.listeners.onMessageExternal,
      { type: 'open-panel' },
      { origin: 'https://visaai.co', tab: { id: 1, windowId: 9 } },
    )
    expect(open).toHaveBeenCalledWith({ windowId: 9 })
    expect(r).toEqual({ ok: true })
  })

  it('reports a refusal instead of throwing (the GO badge remains)', async () => {
    const mock = load()
    ;(mock.chrome.sidePanel as any).open = jest.fn(async () => {
      throw new Error('`sidePanel.open()` may only be called in response to a user gesture.')
    })
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const r = await deliver(
      mock.listeners.onMessageExternal,
      { type: 'open-panel' },
      { origin: 'https://visaai.co', tab: { id: 1, windowId: 9 } },
    )
    expect(r).toMatchObject({ ok: false })
  })

  it('refuses an untrusted page', async () => {
    const mock = load()
    const open = jest.fn(async () => undefined)
    ;(mock.chrome.sidePanel as any).open = open
    await deliver(mock.listeners.onMessageExternal, { type: 'open-panel' }, { origin: 'https://evil.test', tab: { id: 1, windowId: 9 } })
    expect(open).not.toHaveBeenCalled()
  })
})

describe('53 — pendingSession is purged, not merely ignored', () => {
  it('schedules a purge alarm at receivedAt + TTL when a session is handed off', async () => {
    const mock = load()
    const now = 1_700_000_000_000
    jest.spyOn(Date, 'now').mockReturnValue(now)
    const r = await deliver(
      mock.listeners.onMessageExternal,
      { type: 'session', token: 't', apiUrl: 'https://api.visaai.co', readbackToken: 'rb' },
      { origin: 'https://visaai.co' },
    )
    expect(r).toEqual({ ok: true })
    expect(mock.store.pendingSession).toBeDefined()
    expect(mock.chrome.alarms.create).toHaveBeenCalledWith(expect.any(String), { when: now + TTL })
  })

  it('the alarm removes a stale session and clears the badge', async () => {
    const mock = load()
    const receivedAt = 1_700_000_000_000
    mock.store.pendingSession = { token: 't', apiUrl: 'https://api.visaai.co', readbackToken: 'rb', receivedAt }
    jest.spyOn(Date, 'now').mockReturnValue(receivedAt + TTL + 1)
    const [name] = (mock.chrome.alarms.create.mock.calls[0] ?? ['purge-pending-session']) as [string]
    expect(mock.listeners.onAlarm.length).toBeGreaterThan(0)
    for (const l of mock.listeners.onAlarm) l({ name, scheduledTime: receivedAt + TTL })
    await flush()
    expect(mock.store.pendingSession).toBeUndefined()
    expect(mock.chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '' })
  })

  it('the alarm leaves a session that is still fresh (a newer handoff replaced it)', async () => {
    const mock = load()
    const receivedAt = 1_700_000_000_000
    mock.store.pendingSession = { token: 't', apiUrl: 'https://api.visaai.co', receivedAt }
    jest.spyOn(Date, 'now').mockReturnValue(receivedAt + 1000)
    expect(mock.listeners.onAlarm.length).toBeGreaterThan(0)
    for (const l of mock.listeners.onAlarm) l({ name: 'purge-pending-session', scheduledTime: 0 })
    await flush()
    expect(mock.store.pendingSession).toBeDefined()
  })

  it('a worker start purges a session that outlived its TTL (alarm missed, browser restarted)', async () => {
    const mock = load({
      pendingSession: { token: 't', apiUrl: 'https://api.visaai.co', readbackToken: 'rb', receivedAt: Date.now() - TTL - 1 },
    })
    await flush()
    expect(mock.store.pendingSession).toBeUndefined()
  })

  it('a worker start keeps a session that is still fresh', async () => {
    const mock = load({
      pendingSession: { token: 't', apiUrl: 'https://api.visaai.co', receivedAt: Date.now() },
    })
    await flush()
    expect(mock.store.pendingSession).toBeDefined()
  })
})

describe('57 — the bound session dies with the page it was bound to', () => {
  it('navigating the bound tab unbinds it: the next write reaches no tab', async () => {
    const mock = load()
    await bind(mock, 7)
    expect(mock.listeners.tabsUpdated.length).toBeGreaterThan(0)
    for (const l of mock.listeners.tabsUpdated) l(7, { url: 'https://other.canada.ca/elsewhere' }, {})
    const r = await deliver(mock.listeners.onMessage, { type: 'pf-execute-field', command: command() })
    expect(r).toMatchObject({ outcome: 'failed', reason: 'transport_error' })
    expect(mock.chrome.tabs.sendMessage).not.toHaveBeenCalled()
  })

  it('a reload (status: loading) of the bound tab unbinds it', async () => {
    const mock = load()
    await bind(mock, 7)
    for (const l of mock.listeners.tabsUpdated) l(7, { status: 'loading' }, {})
    const r = await deliver(mock.listeners.onMessage, { type: 'pf-execute-field', command: command() })
    expect(r).toMatchObject({ outcome: 'failed', reason: 'transport_error' })
    expect(mock.chrome.tabs.sendMessage).not.toHaveBeenCalled()
  })

  it('closing the bound tab unbinds it', async () => {
    const mock = load()
    await bind(mock, 7)
    expect(mock.listeners.tabsRemoved.length).toBeGreaterThan(0)
    for (const l of mock.listeners.tabsRemoved) l(7, {})
    const r = await deliver(mock.listeners.onMessage, { type: 'pf-probe', selectors: ['#a'] })
    expect(r).toEqual({ error: 'no_session' })
  })

  it('other tabs, and non-navigation updates of the bound tab, leave the binding alone', async () => {
    const mock = load()
    await bind(mock, 7)
    for (const l of mock.listeners.tabsUpdated) {
      l(8, { url: 'https://x.canada.ca/', status: 'loading' }, {})
      l(7, { title: 'Step 2' }, {})
    }
    for (const l of mock.listeners.tabsRemoved) l(8, {})
    const result = { protocol: PORTAL_FILL_PROTOCOL_VERSION, kind: 'field_result', outcome: 'verified' }
    mock.chrome.tabs.sendMessage.mockResolvedValue(result)
    const r = await deliver(mock.listeners.onMessage, { type: 'pf-execute-field', command: command() })
    expect(r).toEqual(result)
    expect(mock.chrome.tabs.sendMessage).toHaveBeenCalledWith(7, expect.objectContaining({ type: 'execute-field-intent' }))
  })
})

describe('59 — onMessage acts only on this extension', () => {
  it('ignores a bind from another sender id', async () => {
    const mock = load()
    const r = await deliver(
      mock.listeners.onMessage,
      { type: 'pf-bind-session', executionId: 'exec-1', tabId: 7 },
      { id: 'some-other-extension' },
      50,
    )
    expect(r).toBe('NO_RESPONSE')
    // and nothing was bound
    const probe = await deliver(mock.listeners.onMessage, { type: 'pf-probe', selectors: ['#a'] })
    expect(probe).toEqual({ error: 'no_session' })
  })

  it('still serves its own extension', async () => {
    const mock = load()
    const r = await deliver(
      mock.listeners.onMessage,
      { type: 'pf-bind-session', executionId: 'exec-1', tabId: 7 },
      { id: EXT_ID },
    )
    expect(r).toEqual({ ok: true })
  })
})

// Review of b196f0c0: the web page retries a hand-off it got no answer to.
// When the first reply was only slow, the same single-use token arrives twice;
// storing it again made an open panel reconnect with a spent token.
describe('a retried hand-off of the same launch is not stored twice', () => {
  it('acknowledges the repeat without storing pendingSession again', async () => {
    const mock = load()
    mock.chrome.tabs.query = jest.fn(async () => []) as any
    const msg = { type: 'session', token: 'tok-1', apiUrl: 'https://api.visaai.co', readbackToken: 'rb' }
    const from = { origin: 'https://visaai.co', tab: { id: 1, windowId: 9 } }
    expect(await deliver(mock.listeners.onMessageExternal, msg, from)).toEqual({ ok: true })
    expect(mock.store.pendingSession).toMatchObject({ token: 'tok-1' })
    // The panel took it.
    delete mock.store.pendingSession
    expect(await deliver(mock.listeners.onMessageExternal, msg, from)).toEqual({ ok: true })
    expect(mock.store.pendingSession).toBeUndefined()
    // Only a hash is kept, never the token.
    expect(JSON.stringify(mock.store.handledSessionTokens)).not.toContain('tok-1')
    // A new launch (new token) is stored as before.
    expect(await deliver(mock.listeners.onMessageExternal, { ...msg, token: 'tok-2' }, from)).toEqual({ ok: true })
    expect(mock.store.pendingSession).toMatchObject({ token: 'tok-2' })
  })
})
