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
