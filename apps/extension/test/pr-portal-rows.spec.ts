/**
 * @jest-environment-options {"url": "https://prson-srpel.apps.cic.gc.ca/en/application/case/1/imm5669?pageId=page2&documentId=111"}
 */
/// <reference types="chrome" />
declare function require(id: string): unknown
import { deliver, installChromeMock, type ChromeMock } from './chrome-mock'
import { hashValue, normalizeValue } from '../src/readback-engine'
import { PORTAL_FILL_PROTOCOL_VERSION, type PortalFillWriteCommand } from '../src/shared'
import {
  forgetPrincipalForms,
  parseScopedSelector,
  principalFormHere,
  resolveTarget,
  rowIndexOf,
  rowSelector,
} from '../src/executor/resolve-target'
import { isSafeInlineAddButton } from '../src/executor/safety-guards'

/**
 * IRCC Permanent Residence Portal, IMM 5669 (live 2026-10-20):
 *  - every person on the application has their own form at the same path
 *    with the same ids; only Section A shows whose ("Yourself (the
 *    principal applicant)" checked). The URL's documentId is the form, the
 *    same in every section. `>> principal` passes on the principal's own
 *    form only.
 *  - sections C, D and H add rows with an inline "Add another" button
 *    (no id, type=button, no dialog); rows are `#from0`, `#from1`…
 */
const at = (pageId: string, documentId: string) =>
  window.history.replaceState(null, '', `/en/application/case/1/imm5669?pageId=${pageId}&documentId=${documentId}`)

const sectionA = (principal: boolean) => `
  <h2>Section A: Personal details</h2>
  <input type="radio" id="principalApplicant" name="principalApplicant" disabled ${principal ? 'checked' : ''}>
  <input type="radio" id="principalOther" name="principalApplicant" disabled ${principal ? '' : 'checked'}>
  <input id="nativeFullName">`

/** Section H with `rows` rows and the page's one "Add another". */
function sectionH(rows: number, extraButton = '') {
  document.body.innerHTML = `
    <h2>Section H: Addresses</h2>
    <div id="rows"></div>
    <button type="button" id="">Add another</button>${extraButton}
    <button type="submit">Save and continue</button>`
  const box = document.getElementById('rows')!
  const addRow = () => {
    const i = box.querySelectorAll('input[id^="from"]').length
    box.insertAdjacentHTML('beforeend', `<div><input id="from${i}"><input id="street${i}"></div>`)
  }
  for (let i = 0; i < rows; i++) addRow()
  ;(document.querySelector('button[type="button"]') as HTMLButtonElement).addEventListener('click', addRow)
  return box
}

const H = (css: string) => `${css} >> page=/Section H: Addresses/i >> principal`
const h = (v: string) => hashValue(normalizeValue(v))
async function cmd(selector: string, mappedValue: string, op?: PortalFillWriteCommand['op']): Promise<PortalFillWriteCommand> {
  return {
    protocol: PORTAL_FILL_PROTOCOL_VERSION,
    kind: 'write',
    executionId: 'exec-1',
    fieldKey: 'k',
    selector,
    mappedValue,
    expectedValueHash: await h(mappedValue),
    ...(op ? { op } : {}),
  }
}

let mock: ChromeMock
const run = (command: PortalFillWriteCommand, ms = 8000) =>
  deliver(mock.listeners.onMessage, { type: 'execute-field-intent', command }, undefined, ms) as Promise<{
    outcome: string
    reason?: string
  }>
const probe = (selectors: string[], ops: Array<PortalFillWriteCommand['op'] | null>) =>
  deliver(mock.listeners.onMessage, { type: 'readback', selectors, ops }, undefined, 2000) as Promise<
    Array<{ selector: string; found: boolean }>
  >

beforeEach(() => {
  forgetPrincipalForms()
  mock = installChromeMock()
  jest.isolateModules(() => {
    require('../src/content')
  })
})

describe('whose form: `>> principal`', () => {
  it('parses as a scope part; the option still comes last', () => {
    expect(parseScopedSelector('#a >> principal')).toEqual({ css: '#a', principal: true })
    expect(parseScopedSelector('#a >> page=/x/i >> principal >> option=text:Yes')).toMatchObject({ principal: true })
    expect(parseScopedSelector('#a >> principal >> principal')).toBeNull()
    expect(parseScopedSelector('#a >> option=text:Yes >> principal')).toBeNull()
    expect(parseScopedSelector('#a >> rows=3 >> keep >> principal')).toEqual({ css: '#a', rows: 3, keep: true, principal: true })
    expect(parseScopedSelector('#a >> rows=0')).toBeNull()
  })

  it("Section A with the principal radio checked passes, and the form's later sections then pass", () => {
    at('page2', '111')
    document.body.innerHTML = sectionA(true)
    expect(resolveTarget('#nativeFullName >> principal').status).toBe('found')
    at('page9', '111')
    sectionH(1)
    expect(resolveTarget(H('#from0')).status).toBe('found')
  })

  it("a dependant's form never passes, and its Section A also forgets a stale memory", () => {
    at('page2', '222')
    document.body.innerHTML = sectionA(false)
    expect(resolveTarget('#nativeFullName >> principal').status).toBe('missing')
    at('page9', '222')
    sectionH(1)
    expect(resolveTarget(H('#from0')).status).toBe('missing')
    // Remembered once, then the same documentId shows "on behalf of": forgotten.
    at('page2', '333')
    document.body.innerHTML = sectionA(true)
    expect(principalFormHere()).toBe(true)
    document.body.innerHTML = sectionA(false)
    expect(principalFormHere()).toBe(false)
    at('page9', '333')
    sectionH(1)
    expect(principalFormHere()).toBe(false)
  })

  it('a later section opened before its Section A was seen does not pass', () => {
    at('page9', '444')
    sectionH(1)
    expect(resolveTarget(H('#from0')).status).toBe('missing')
  })

  it('the memory survives a reload of the tab (session storage)', () => {
    at('page2', '555')
    document.body.innerHTML = sectionA(true)
    expect(principalFormHere()).toBe(true)
    expect(window.sessionStorage.getItem('visaai.prPrincipalDocuments')).toContain('555')
  })

  // Review: a lone "Yourself" radio (its companion not rendered) is not proof.
  it('principal only with the full radio pair: "Yourself" checked and its companion unchecked', () => {
    at('page2', '666')
    document.body.innerHTML = '<input type="radio" id="principalApplicant" checked disabled>'
    expect(principalFormHere()).toBe(false)
    at('page9', '666')
    sectionH(1)
    expect(principalFormHere()).toBe(false)
  })

  // Review: the memory is per application, form and documentId.
  it('remembered per case and form: the same documentId on another form or case does not pass', () => {
    at('page2', '777')
    document.body.innerHTML = sectionA(true)
    expect(principalFormHere()).toBe(true)
    expect(window.sessionStorage.getItem('visaai.prPrincipalDocuments')).toContain('1|imm5669|777')
    window.history.replaceState(null, '', '/en/application/case/1/imm5406?pageId=page3&documentId=777')
    document.body.innerHTML = '<h2>Section B: Children</h2>'
    expect(principalFormHere()).toBe(false)
    window.history.replaceState(null, '', '/en/application/case/2/imm5669?pageId=page9&documentId=777')
    expect(principalFormHere()).toBe(false)
  })

  it('row helpers', () => {
    expect(rowIndexOf(H('#from12'))).toBe(12)
    expect(rowSelector(H('#from2'), 1)).toBe(H('#from1'))
    expect(rowSelector('#nope', 1)).toBeNull()
  })
})

describe('inline row add (`row_add`)', () => {
  const principal = () => {
    at('page2', '111')
    document.body.innerHTML = sectionA(true)
    principalFormHere()
    at('page9', '111')
  }

  it('the guarded button: exact text, type=button, PR host, not in a dialog', () => {
    sectionH(1, '<button type="button" id="b2">Add another and continue</button><div role="dialog"><button type="button" id="b3">Add another</button></div>')
    const buttons = Array.from(document.querySelectorAll('button'))
    expect(buttons.map((b) => isSafeInlineAddButton(b))).toEqual([true, false, false, false])
  })

  it('adds the missing row with one click, then the row is there', async () => {
    principal()
    const box = sectionH(1)
    const r = await run(await cmd(H('#from1'), 'Address row 2', 'row_add'))
    expect(r.outcome).toBe('verified')
    expect(box.querySelectorAll('input[id^="from"]').length).toBe(2)
  })

  it('a row already there is not added again (re-run)', async () => {
    principal()
    const box = sectionH(2)
    const r = await run(await cmd(H('#from1'), 'Address row 2', 'row_add'))
    expect(r.outcome).toBe('verified')
    expect(box.querySelectorAll('input[id^="from"]').length).toBe(2)
  })

  it('never skips ahead: row 3 is not added while row 2 is missing', async () => {
    principal()
    const box = sectionH(1)
    const r = await run(await cmd(H('#from2'), 'Address row 3', 'row_add'))
    expect(r).toMatchObject({ outcome: 'failed', reason: 'selector_missing' })
    expect(box.querySelectorAll('input[id^="from"]').length).toBe(1)
  })

  it("never on a dependant's form", async () => {
    at('page2', '222')
    document.body.innerHTML = sectionA(false)
    at('page9', '222')
    const box = sectionH(1)
    const r = await run(await cmd(H('#from1'), 'Address row 2', 'row_add'))
    expect(r).toMatchObject({ outcome: 'failed', reason: 'selector_missing' })
    expect(box.querySelectorAll('input[id^="from"]').length).toBe(1)
  })

  it('never on another section', async () => {
    principal()
    const box = sectionH(1)
    const r = await run(await cmd('#from1 >> page=/Section D: Personal history/i >> principal', 'History row 2', 'row_add'))
    expect(r).toMatchObject({ outcome: 'failed', reason: 'selector_missing' })
    expect(box.querySelectorAll('input[id^="from"]').length).toBe(1)
  })

  // Review L4: the row after the one being added must not be there.
  it('rows out of order (row 3 there, row 2 not): nothing is clicked', async () => {
    principal()
    const box = sectionH(1)
    box.insertAdjacentHTML('beforeend', '<div><input id="from2"><input id="street2"></div>')
    const r = await run(await cmd(H('#from1'), 'Address row 2', 'row_add'))
    expect(r).toMatchObject({ outcome: 'failed', reason: 'unsafe_target' })
    expect(box.querySelectorAll('input[id^="from"]').length).toBe(2)
  })

  // Review L5: more rows on the page than the reviewed data refuses the section.
  it('`>> rows=N`: a page with more rows than the data is refused before any row is written', async () => {
    principal()
    sectionH(3)
    const guard = '#from0 >> rows=2 >> page=/Section H: Addresses/i >> principal'
    expect(await run(await cmd(guard, 'Address: 2 rows', 'row_add'))).toMatchObject({ outcome: 'failed', reason: 'unsafe_target' })
    sectionH(2)
    expect((await run(await cmd(guard, 'Address: 2 rows', 'row_add'))).outcome).toBe('verified')
  })

  // Review L5: an existing different value is never overwritten.
  it('`>> keep`: an empty or equal box is written, a different one is refused and left', async () => {
    principal()
    sectionH(1)
    const street = (v: string) => ((document.getElementById('street0') as HTMLInputElement).value = v)
    const sel = '#street0 >> page=/Section H: Addresses/i >> principal >> keep'
    expect((await run(await cmd(sel, '12 Test Road'))).outcome).toBe('verified')
    street('12 Test Road')
    expect((await run(await cmd(sel, '12 Test Road'))).outcome).toBe('verified')
    street('99 Other Street')
    expect(await run(await cmd(sel, '12 Test Road'))).toMatchObject({ outcome: 'failed', reason: 'value_mismatch' })
    expect((document.getElementById('street0') as HTMLInputElement).value).toBe('99 Other Street')
  })

  it('two "Add another" buttons on one screen: which one is not guessed', async () => {
    principal()
    const box = sectionH(1, '<button type="button">Add another</button>')
    const r = await run(await cmd(H('#from1'), 'Address row 2', 'row_add'))
    expect(r).toMatchObject({ outcome: 'failed', reason: 'unsafe_target' })
    expect(box.querySelectorAll('input[id^="from"]').length).toBe(1)
  })

  it('the probe: present when the row is there or can be added now', async () => {
    principal()
    sectionH(1)
    const r = await probe([H('#from0'), H('#from1'), H('#from2')], ['row_add', 'row_add', 'row_add'])
    expect(r.map((x) => x.found)).toEqual([true, true, false])
  })

  it('then fills the added row like any field', async () => {
    principal()
    sectionH(1)
    await run(await cmd(H('#from1'), 'Address row 2', 'row_add'))
    const w = await run(await cmd(H('#street1'), '5 Old Street'))
    expect(w.outcome).toBe('verified')
    expect((document.getElementById('street1') as HTMLInputElement).value).toBe('5 Old Street')
  })
})
