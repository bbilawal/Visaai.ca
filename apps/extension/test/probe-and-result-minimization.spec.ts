/// <reference types="chrome" />
declare function require(id: string): unknown
import { deliver, installChromeMock, type ChromeMock } from './chrome-mock'
import { hashValue, normalizeValue } from '../src/readback-engine'
import { PORTAL_FILL_PROTOCOL_VERSION, type PortalFillWriteCommand } from '../src/shared'

/**
 * Two release-review findings on 0.1.4, fixed in 0.1.5 (REVIEW_HANDOFF §35).
 *
 *  A — The probe must apply the same rule as the writer. `readbackFields`
 *      reported a field `found` whenever the selector resolved, but the writer
 *      also refuses hidden, disabled and read-only controls. A present-but-
 *      collapsed field therefore passed the all-or-nothing probe, fields 1..k
 *      were written, and the run stopped at k+1 — a partly filled government
 *      form, contradicting "entered only if every field is found".
 *  B — A failed field must not carry the hash of what is in the page. The hash
 *      is unsalted SHA-256, and for short values (a date, a country) it is
 *      recoverable by guessing, so on a mismatch it discloses page contents.
 *      On a match it equals the expected hash the server already holds.
 */

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

let mock: ChromeMock
beforeEach(() => {
  document.body.innerHTML = `
    <input id="passport" type="text" />
    <div style="display:none"><input id="employer" type="text" /></div>
    <input id="locked" type="text" disabled />
    <input id="fixed" type="text" readonly />`
  mock = installChromeMock()
  jest.isolateModules(() => {
    require('../src/content')
  })
})

describe('A — the probe reports a field the writer would refuse as not found', () => {
  it('hidden, disabled and read-only fields are not found; a plain visible field is', async () => {
    const r = await deliver(
      mock.listeners.onMessage,
      { type: 'readback', selectors: ['#passport', '#employer', '#locked', '#fixed'] },
      undefined,
      500,
    )
    expect(r).toEqual([
      expect.objectContaining({ selector: '#passport', found: true }),
      expect.objectContaining({ selector: '#employer', found: false }),
      expect.objectContaining({ selector: '#locked', found: false }),
      expect.objectContaining({ selector: '#fixed', found: false }),
    ])
  })
})

describe('B — a field result carries a value hash only when it matched', () => {
  it('a mismatch reports value_mismatch with no actualValueHash', async () => {
    const r = await deliver(
      mock.listeners.onMessage,
      { type: 'execute-field-intent', command: command({ expectedValueHash: 'not-the-hash' }) },
      undefined,
      1000,
    )
    expect(r).toMatchObject({ outcome: 'failed', reason: 'value_mismatch', selectorFound: true })
    expect(r).not.toHaveProperty('actualValueHash')
  })

  it('a match reports verified with the expected hash, which the server already holds', async () => {
    const expected = await hashValue(normalizeValue('X1234567'))
    const r = await deliver(
      mock.listeners.onMessage,
      { type: 'execute-field-intent', command: command({ expectedValueHash: expected }) },
      undefined,
      1000,
    )
    expect(r).toMatchObject({ outcome: 'verified', actualValueHash: expected, selectorFound: true })
  })
})
