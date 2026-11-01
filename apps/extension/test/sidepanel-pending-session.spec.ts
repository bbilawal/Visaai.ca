/// <reference types="chrome" />
declare function require(id: string): unknown
import { flush, installChromeMock, type ChromeMock } from './chrome-mock'

/**
 * REVIEW_HANDOFF §27.7 item 53, reader side. The side panel only CONSUMED a
 * fresh pendingSession; a stale one was skipped and left where it was, so its
 * readbackToken (the applicant's mapped values) stayed in chrome.storage.local
 * for good. A stale session must be purged on read, and never connected.
 */

const io = jest.fn(() => ({ on: jest.fn(), emit: jest.fn(), disconnect: jest.fn() }))
jest.mock('socket.io-client', () => ({ io: (...a: unknown[]) => (io as (...x: unknown[]) => unknown)(...a) }))

const TTL = 5 * 60 * 1000

function load(storage: Record<string, unknown>): ChromeMock {
  document.body.innerHTML = `
    <div id="connect"><input id="apiUrl" /><input id="token" /><button id="connectBtn"></button></div>
    <div id="session"><div id="steps"></div></div>
    <div id="status"></div><div id="error"></div>`
  const mock = installChromeMock(storage)
  jest.isolateModules(() => {
    require('../src/sidepanel')
  })
  return mock
}

beforeEach(() => io.mockClear())

describe('53 — the side panel purges a stale pendingSession', () => {
  it('removes a session past its TTL and does not connect with it', async () => {
    const mock = load({
      pendingSession: { token: 't', apiUrl: 'https://api.visaai.co', readbackToken: 'rb', receivedAt: Date.now() - TTL - 1 },
    })
    await flush(10)
    expect(mock.store.pendingSession).toBeUndefined()
    expect(io).not.toHaveBeenCalled()
  })

  it('removes a malformed session (no receivedAt)', async () => {
    const mock = load({ pendingSession: { token: 't', apiUrl: 'https://api.visaai.co', readbackToken: 'rb' } })
    await flush(10)
    expect(mock.store.pendingSession).toBeUndefined()
    expect(io).not.toHaveBeenCalled()
  })

  it('still consumes a fresh session: removed, and connected', async () => {
    const mock = load({
      pendingSession: { token: 't', apiUrl: 'https://api.visaai.co', readbackToken: 'rb', receivedAt: Date.now() },
    })
    await flush(10)
    expect(mock.store.pendingSession).toBeUndefined()
    expect(io).toHaveBeenCalledTimes(1)
  })
})

describe('an open panel takes the next launch (dry run 2026-10-16)', () => {
  it('connects when VisaAI hands off a new session while the panel is open', async () => {
    const mock = load({})
    await flush(10)
    expect(io).not.toHaveBeenCalled()
    const pending = { token: 't2', apiUrl: 'https://api.visaai.co', readbackToken: 'rb2', receivedAt: Date.now() }
    mock.store.pendingSession = pending
    for (const fn of mock.listeners.storageChanged) fn({ pendingSession: { newValue: pending } }, 'local')
    await flush(10)
    expect(io).toHaveBeenCalledTimes(1)
    expect(mock.store.pendingSession).toBeUndefined()
  })

  it('ignores the removal of a consumed session', async () => {
    const mock = load({})
    await flush(10)
    for (const fn of mock.listeners.storageChanged) fn({ pendingSession: { oldValue: {} } }, 'local')
    await flush(10)
    expect(io).not.toHaveBeenCalled()
  })
})

// Review of b196f0c0: a slow-but-delivered first hand-off and the page's retry
// carry the same token. The open panel must not drop its live socket for it.
describe('the same launch handed off twice', () => {
  it('connects once; the repeated token is consumed without reconnecting', async () => {
    const mock = load({})
    await flush(10)
    const pending = { token: 'same', apiUrl: 'https://api.visaai.co', readbackToken: 'rb', receivedAt: Date.now() }
    for (let i = 0; i < 2; i++) {
      mock.store.pendingSession = { ...pending }
      for (const fn of mock.listeners.storageChanged) fn({ pendingSession: { newValue: pending } }, 'local')
      await flush(10)
    }
    expect(io).toHaveBeenCalledTimes(1)
    expect(mock.store.pendingSession).toBeUndefined()
  })
})
