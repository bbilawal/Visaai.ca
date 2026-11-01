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
