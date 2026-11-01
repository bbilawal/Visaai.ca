/// <reference types="chrome" />
declare function require(id: string): unknown
import { deliver, flush, installChromeMock, type ChromeMock } from './chrome-mock'
import { executeWrite } from '../src/executor/field-executor'
import { readField } from '../src/executor/readback'
import { dryRunField } from '../src/portal-fill-executor'
import { PORTAL_FILL_PROTOCOL_VERSION, type PortalFillWriteCommand } from '../src/shared'

/**
 * How the content script resolves a server-supplied selector
 * (REVIEW_HANDOFF §27.7 items 55, 58, 59).
 *
 *  55 — `querySelector` THROWS a SyntaxError on an invalid selector. None of
 *       the four call sites caught it and content.ts's `.then(sendResponse)`
 *       had no `.catch`, so the message port closed without an answer and the
 *       run stalled for the full 15s bridge timeout instead of failing that
 *       field at once.
 *  58 — first-match with no ambiguity check. If a selector matches two fields,
 *       the write lands on the first, the readback re-queries the same first
 *       match, and a write to the wrong field verifies as correct. A selector
 *       must identify exactly one element, and the probe must say when it
 *       does not.
 *  59 — the content script's onMessage acts only on this extension.
 */

const INVALID = '#passport[' // unterminated attribute selector

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

beforeEach(() => {
  document.body.innerHTML = `
    <input id="passport" type="text" />
    <input class="dup" name="a" type="text" />
    <input class="dup" name="b" type="text" />`
})

describe('55 — an invalid selector fails the field, it does not throw', () => {
  it('executeWrite', () => {
    expect(() => executeWrite(INVALID, 'x')).not.toThrow()
    expect(executeWrite(INVALID, 'x')).toMatchObject({ written: false, reason: 'selector_missing' })
  })

  it('readField', async () => {
    await expect(readField(INVALID, undefined, 0)).resolves.toMatchObject({ found: false })
  })

  it('dryRunField', async () => {
    await expect(dryRunField(command({ selector: INVALID }))).resolves.toMatchObject({
      outcome: 'failed',
      reason: 'selector_missing',
    })
  })
})

describe('58 — a selector must identify exactly one field', () => {
  it('refuses to write when the selector matches more than one element', () => {
    const out = executeWrite('.dup', 'X1234567')
    expect(out).toMatchObject({ written: false, reason: 'unsafe_target' })
    for (const el of Array.from(document.querySelectorAll<HTMLInputElement>('.dup'))) {
      expect(el.value).toBe('')
    }
  })

  it('readback does not report the first of several matches as the field', async () => {
    await expect(readField('.dup', undefined, 0)).resolves.toMatchObject({ found: false })
  })

  it('still writes a selector that matches exactly one element', () => {
    expect(executeWrite('#passport', 'X1234567')).toMatchObject({ written: true })
  })
})

describe('content script message handling', () => {
  let mock: ChromeMock
  beforeEach(() => {
    mock = installChromeMock()
    jest.isolateModules(() => {
      require('../src/content')
    })
  })

  it('55 — execute-field-intent with an invalid selector answers at once with a failure', async () => {
    const r = await deliver(
      mock.listeners.onMessage,
      { type: 'execute-field-intent', command: command({ selector: INVALID }) },
      undefined,
      500,
    )
    expect(r).toMatchObject({ outcome: 'failed', fieldKey: 'passport_number', selectorFound: false })
  })

  it('55 — readback (the probe) with an invalid selector answers, reporting it not found', async () => {
    const r = await deliver(mock.listeners.onMessage, { type: 'readback', selectors: [INVALID, '#passport'] }, undefined, 500)
    expect(r).toEqual([
      expect.objectContaining({ selector: INVALID, found: false }),
      expect.objectContaining({ selector: '#passport', found: true }),
    ])
  })

  it('55 — field-readback with an invalid selector answers', async () => {
    const r = await deliver(mock.listeners.onMessage, { type: 'field-readback', selector: INVALID }, undefined, 1000)
    expect(r).toMatchObject({ selector: INVALID, found: false })
  })

  it('58 — the probe reports an ambiguous selector as not found, and says why', async () => {
    const r = await deliver(mock.listeners.onMessage, { type: 'readback', selectors: ['.dup'] }, undefined, 500)
    expect(r).toEqual([expect.objectContaining({ selector: '.dup', found: false, ambiguous: true })])
  })

  it('59 — ignores a write from another sender id', async () => {
    const r = await deliver(
      mock.listeners.onMessage,
      { type: 'execute-field-intent', command: command() },
      { id: 'some-other-extension' },
      400,
    )
    await flush()
    expect(r).toBe('NO_RESPONSE')
    expect((document.querySelector('#passport') as HTMLInputElement).value).toBe('')
  })
})
