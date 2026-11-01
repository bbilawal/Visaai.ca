/// <reference types="chrome" />
declare function require(id: string): unknown
declare const __dirname: string
import { deliver, installChromeMock, type ChromeMock } from './chrome-mock'
import { hashValue, normalizeValue } from '../src/readback-engine'
import { PORTAL_FILL_PROTOCOL_VERSION, type PortalFillWriteCommand } from '../src/shared'
import { executeSelectByText, executeSelectByTextWhenListed } from '../src/executor/field-executor'
import { resolveTarget } from '../src/executor/resolve-target'

/**
 * The IRCC eTA form (recorded live 2026-10-16) is one page: ids contain dots,
 * every question is a <select> whose option values are list indexes, and the
 * same page is filled again by each launch as more of it is revealed.
 */

const h = (v: string) => hashValue(normalizeValue(v))
const ID = 'applicationDetails.personalDetails_dobMonth'
const SEL = `[id="${ID}"]`

let mock: ChromeMock
function load() {
  mock = installChromeMock()
  jest.isolateModules(() => {
    require('../src/content')
  })
}
async function run(selector: string, mappedValue: string, awaitOptions = false) {
  const command: PortalFillWriteCommand = {
    protocol: PORTAL_FILL_PROTOCOL_VERSION,
    kind: 'write',
    executionId: 'exec-1',
    fieldKey: 'date_of_birth',
    selector,
    mappedValue,
    expectedValueHash: await h(mappedValue),
    op: 'select_text',
    ...(awaitOptions ? { awaitOptions: true } : {}),
  }
  return deliver(mock.listeners.onMessage, { type: 'execute-field-intent', command }, undefined, 8000) as Promise<{
    outcome: string
    reason?: string
  }>
}

beforeEach(() => {
  document.body.innerHTML = `
    <select id="${ID}">
      <option value="">Select…</option>
      <option value="0">April</option>
      <option value="1">May</option>
      <option value="2">June</option>
    </select>`
})

describe('eTA ids with dots', () => {
  it('an attribute selector names the one element; #a.b would not', () => {
    expect(resolveTarget(SEL).status).toBe('found')
    expect(resolveTarget('#applicationDetails.personalDetails_dobMonth').status).toBe('missing')
  })

  it('chooses the option by its text (values are list indexes) and verifies it', async () => {
    load()
    const r = await run(SEL, 'May')
    expect(r.outcome).toBe('verified')
    expect((document.getElementById(ID) as HTMLSelectElement).value).toBe('1')
  })
})

describe('filling the same page again', () => {
  it('an option already chosen is left alone: no change event re-fires', () => {
    const el = document.getElementById(ID) as HTMLSelectElement
    el.value = '1'
    const changes = jest.fn()
    el.addEventListener('change', changes)
    const r = executeSelectByText(SEL, 'May')
    expect(r).toMatchObject({ written: true, node: el })
    expect(changes).not.toHaveBeenCalled()
    expect(el.value).toBe('1')
  })

  it('a different option is still chosen, with the events the form listens for', () => {
    const el = document.getElementById(ID) as HTMLSelectElement
    el.value = '0'
    const changes = jest.fn()
    el.addEventListener('change', changes)
    executeSelectByText(SEL, 'May')
    expect(el.value).toBe('1')
    expect(changes).toHaveBeenCalledTimes(1)
  })

  it('re-running a verified answer verifies again without rewriting it', async () => {
    load()
    const el = document.getElementById(ID) as HTMLSelectElement
    el.value = '1'
    const changes = jest.fn()
    el.addEventListener('change', changes)
    expect((await run(SEL, 'May')).outcome).toBe('verified')
    expect(changes).not.toHaveBeenCalled()
  })
})

describe('host permissions cover the eTA host', () => {
  it('the manifest matches eta.onlineservices-servicesenligne.apps.cic.gc.ca', () => {
    const fs = require('fs') as { readFileSync: (p: string, e: string) => string }
    const path = require('path') as { join: (...p: string[]) => string }
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'))
    const host = 'eta.onlineservices-servicesenligne.apps.cic.gc.ca'
    const matches = (pattern: string) => {
      const m = /^https:\/\/\*\.([^/]+)\/\*$/.exec(pattern)
      return !!m && host.endsWith(`.${m[1]}`)
    }
    expect(manifest.host_permissions.some(matches)).toBe(true)
    expect(manifest.content_scripts[0].matches.some(matches)).toBe(true)
  })
})

describe("the eTA form's own buttons are never pressed", () => {
  it('Next, Pay and Submit are refused even when an id says "add"', () => {
    const { isSafeAddButton } = require('../src/executor/safety-guards') as typeof import('../src/executor/safety-guards')
    for (const text of [
      'Next',
      'Pay now',
      'Submit',
      'Continue to payment',
      // IRCC Permanent Residence Portal (2026-10-20).
      'Complete and return to application',
      'Return to application',
      'Consent and declaration',
      'Declaration',
    ]) {
      document.body.innerHTML = `<button id="addSomething">${text}</button>`
      expect(isSafeAddButton(document.getElementById('addSomething')!, false)).toBe(false)
    }
  })
})

describe('a select whose options load after an earlier answer (eTA job title, live 2026-10-18)', () => {
  const TITLE = 'applicationDetails.employmentDetails_title'
  const TSEL = `[id="${TITLE}"]`
  const WANT = 'Computer and information systems professionals'
  const listLater = (ms: number, opts: { disabled?: boolean } = {}) => {
    document.body.innerHTML = `<select id="${TITLE}"${opts.disabled ? ' disabled' : ''}><option value="">Select…</option></select>`
    setTimeout(() => {
      const el = document.getElementById(TITLE) as HTMLSelectElement
      el.innerHTML = `<option value="">Select…</option><option value="0">Other engineers</option><option value="1">${WANT}</option>`
      el.disabled = false
    }, ms)
  }

  it('awaitOptions: waits for the option to be listed, then chooses it and verifies', async () => {
    listLater(1200)
    load()
    const r = await run(TSEL, WANT, true)
    expect(r.outcome).toBe('verified')
    expect((document.getElementById(TITLE) as HTMLSelectElement).value).toBe('1')
  })

  it('without awaitOptions (TRV, super visa, every other select) it fails at once, as before', async () => {
    listLater(1200)
    load()
    const started = Date.now()
    const r = await run(TSEL, WANT)
    expect(r).toMatchObject({ outcome: 'failed', reason: 'selector_missing' })
    expect(Date.now() - started).toBeLessThan(1000)
    expect((document.getElementById(TITLE) as HTMLSelectElement).value).toBe('')
  })

  it('the probe counts a select disabled while loading as present only for awaitOptions', async () => {
    document.body.innerHTML = `<select id="${TITLE}" disabled><option value="">Select…</option></select>`
    load()
    const probe = (awaitOptions?: boolean[]) =>
      deliver(mock.listeners.onMessage, {
        type: 'readback',
        selectors: [TSEL],
        ops: ['select_text'],
        ...(awaitOptions ? { awaitOptions } : {}),
      }) as Promise<Array<{ found: boolean }>>
    expect((await probe())[0].found).toBe(false)
    expect((await probe([false]))[0].found).toBe(false)
    expect((await probe([true]))[0].found).toBe(true)
    // A hidden select is never present, flag or not.
    ;(document.getElementById(TITLE) as HTMLSelectElement).hidden = true
    expect((await probe([true]))[0].found).toBe(false)
  })

  it('stops waiting once the run is gone', async () => {
    listLater(2000)
    let active = true
    setTimeout(() => (active = false), 100)
    const started = Date.now()
    const out = await executeSelectByTextWhenListed(TSEL, WANT, document, 5000, 20, () => active)
    expect(out.written).toBe(false)
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('waits while the select is disabled for loading', async () => {
    listLater(300, { disabled: true })
    const out = await executeSelectByTextWhenListed(TSEL, WANT, document, 2000, 20)
    expect(out.written).toBe(true)
    expect((document.getElementById(TITLE) as HTMLSelectElement).value).toBe('1')
  })

  it('an option that never appears: nothing chosen once the wait is over', async () => {
    listLater(50)
    const started = Date.now()
    const out = await executeSelectByTextWhenListed(TSEL, 'Not on the list', document, 400, 20)
    expect(out).toEqual({ written: false, reason: 'selector_missing' })
    expect(Date.now() - started).toBeGreaterThanOrEqual(350)
    expect((document.getElementById(TITLE) as HTMLSelectElement).value).toBe('')
  })

  it('no select at all, or two matching options: no waiting', async () => {
    document.body.innerHTML = ''
    let started = Date.now()
    expect((await executeSelectByTextWhenListed(TSEL, WANT, document, 3000, 20)).written).toBe(false)
    expect(Date.now() - started).toBeLessThan(500)
    document.body.innerHTML = `<select id="${TITLE}"><option>${WANT}</option><option>${WANT}</option></select>`
    started = Date.now()
    expect((await executeSelectByTextWhenListed(TSEL, WANT, document, 3000, 20)).written).toBe(false)
    expect(Date.now() - started).toBeLessThan(500)
  })
})
