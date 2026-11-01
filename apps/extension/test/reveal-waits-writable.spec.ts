/// <reference types="chrome" />
declare function require(id: string): unknown
import { deliver, installChromeMock, type ChromeMock } from './chrome-mock'
import { hashValue, normalizeValue } from '../src/readback-engine'
import { PORTAL_FILL_PROTOCOL_VERSION, type PortalFillWriteCommand } from '../src/shared'
import { waitForTarget } from '../src/executor/resolve-target'

/**
 * Live 2026-10-21 (PR portal, IMM 0008 page 4): the phone country code is on
 * the page but DISABLED until "Other" is chosen. A revealed value write that
 * only waited for the box to exist found it disabled and failed. It now
 * waits until the box can take the value, within the same deadline.
 */
const h = (v: string) => hashValue(normalizeValue(v))
async function cmd(selector: string, mappedValue: string): Promise<PortalFillWriteCommand> {
  return {
    protocol: PORTAL_FILL_PROTOCOL_VERSION,
    kind: 'write',
    executionId: 'exec-1',
    fieldKey: 'k',
    selector,
    mappedValue,
    expectedValueHash: await h(mappedValue),
    reveal: true,
  }
}

let mock: ChromeMock
const run = (command: PortalFillWriteCommand, ms = 9000) =>
  deliver(mock.listeners.onMessage, { type: 'execute-field-intent', command }, undefined, ms) as Promise<{
    outcome: string
    reason?: string
  }>

beforeEach(() => {
  mock = installChromeMock()
  jest.isolateModules(() => {
    require('../src/content')
  })
})

describe('a revealed value box is waited for until it is writable', () => {
  it('disabled, then enabled a moment later: written', async () => {
    document.body.innerHTML = '<input id="PrimaryCountryCode" disabled value="1">'
    setTimeout(() => {
      const el = document.getElementById('PrimaryCountryCode') as HTMLInputElement
      el.disabled = false
      el.value = ''
    }, 300)
    const r = await run(await cmd('#PrimaryCountryCode', '92'))
    expect(r.outcome).toBe('verified')
    expect((document.getElementById('PrimaryCountryCode') as HTMLInputElement).value).toBe('92')
  })

  it('never enabled: refused at the deadline, nothing written', async () => {
    document.body.innerHTML = '<input id="PrimaryCountryCode" disabled value="1">'
    const r = await run(await cmd('#PrimaryCountryCode', '92'))
    expect(r).toMatchObject({ outcome: 'failed', reason: 'unsafe_target' })
    expect((document.getElementById('PrimaryCountryCode') as HTMLInputElement).value).toBe('1')
  }, 15000)

  it('waitForTarget without `ready` returns as soon as the target exists (unchanged)', async () => {
    document.body.innerHTML = '<input id="x" disabled>'
    const t0 = Date.now()
    const r = await waitForTarget('#x', () => document, 2000)
    expect(r.status).toBe('found')
    expect(Date.now() - t0).toBeLessThan(500)
  })
})
