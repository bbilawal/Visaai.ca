/**
 * @jest-environment-options {"url": "https://prson-srpel.apps.cic.gc.ca/en/application/profile/1"}
 */
/// <reference types="chrome" />
declare function require(id: string): unknown
import { deliver, installChromeMock, type ChromeMock } from './chrome-mock'
import { hashValue, normalizeValue } from '../src/readback-engine'
import { PORTAL_FILL_PROTOCOL_VERSION, type PortalFillWriteCommand } from '../src/shared'
import { forgetPrincipalForms, parseScopedSelector, principalFormHere, resolveTarget } from '../src/executor/resolve-target'

/**
 * IRCC Permanent Residence Portal, phase 2b (live 2026-10-20):
 *  - profile: answering "No" to "residential same as mailing" opens a
 *    residential block that REUSES the mailing ids (streetName, city, …),
 *    after the mailing block in document order (`>> nth=<k>/<most>`).
 *  - IMM 5406 sections B (children) and C (siblings) reuse the same row ids;
 *    each is scoped to its first row's heading ("Child 1" / "Siblings 1").
 *  - IMM 5562 sections A, B and C reuse the trip ids; each is scoped by the
 *    destination id only it has (`body:has(#…) #…`).
 */
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
const probe = (selectors: string[]) =>
  deliver(mock.listeners.onMessage, { type: 'readback', selectors, ops: selectors.map(() => null) }, undefined, 2000) as Promise<
    Array<{ selector: string; found: boolean; ambiguous?: boolean }>
  >
const at = (path: string) => window.history.replaceState(null, '', path)
const value = (el: Element) => (el as HTMLInputElement).value

beforeEach(() => {
  forgetPrincipalForms()
  mock = installChromeMock()
  jest.isolateModules(() => {
    require('../src/content')
  })
})

describe('`>> nth=<k>/<most>`: a block that reuses another block’s ids', () => {
  const block = (tag: string) => `<fieldset data-block="${tag}"><input id="streetName"><input id="city"></fieldset>`
  const MAIL = '#streetName >> nth=1/2'
  const HOME = '#streetName >> nth=2/2'

  beforeEach(() => at('/en/application/profile/1'))

  it('parses; k never above most, one nth per selector, the option still last', () => {
    expect(parseScopedSelector('#a >> nth=2/2')).toEqual({ css: '#a', nth: { k: 2, most: 2 } })
    expect(parseScopedSelector('#a >> nth=1/2 >> option=text:Canada')).toMatchObject({ nth: { k: 1, most: 2 } })
    expect(parseScopedSelector('#a >> nth=3/2')).toBeNull()
    expect(parseScopedSelector('#a >> nth=0/2')).toBeNull()
    expect(parseScopedSelector('#a >> nth=2')).toBeNull()
    expect(parseScopedSelector('#a >> nth=1/2 >> nth=2/2')).toBeNull()
    expect(parseScopedSelector('#a >> option=text:X >> nth=1/2')).toBeNull()
  })

  it('mailing only (residential same): the mailing box is found, the residential one is not there yet', () => {
    document.body.innerHTML = block('mail')
    const mail = resolveTarget(MAIL)
    expect(mail.status).toBe('found')
    expect((mail as { el: Element }).el.closest('fieldset')?.getAttribute('data-block')).toBe('mail')
    expect(resolveTarget(HOME).status).toBe('missing')
  })

  it('both blocks: each box resolves to its own block, and writes land there', async () => {
    document.body.innerHTML = block('mail') + block('home')
    const [mailEl, homeEl] = Array.from(document.querySelectorAll('[id="streetName"]'))
    expect((await run(await cmd(MAIL, 'Post Lane'))).outcome).toBe('verified')
    expect((await run(await cmd(HOME, 'Test Road'))).outcome).toBe('verified')
    expect([value(mailEl), value(homeEl)]).toEqual(['Post Lane', 'Test Road'])
    // A plain id would name two boxes: never written.
    expect(resolveTarget('#streetName').status).toBe('ambiguous')
  })

  it('more blocks than recorded: neither box is guessed, nothing is written', async () => {
    document.body.innerHTML = block('mail') + block('home') + block('third')
    expect(resolveTarget(MAIL).status).toBe('ambiguous')
    expect(resolveTarget(HOME).status).toBe('ambiguous')
    expect(await run(await cmd(HOME, 'Test Road'))).toMatchObject({ outcome: 'failed', reason: 'unsafe_target' })
    expect(Array.from(document.querySelectorAll('[id="streetName"]')).map(value)).toEqual(['', '', ''])
    const r = await probe([MAIL, HOME])
    expect(r.map((x) => x.found)).toEqual([false, false])
  })

  // An extension that predates a scope part (0.1.51 and older for nth) reads
  // the whole selector as invalid: the probe reports it missing (the server
  // then refuses the page) and a write fails without touching the page.
  it('fail-safe: a scope part the extension does not know is never treated as plain CSS', async () => {
    document.body.innerHTML = block('mail') + block('home')
    const unknown = '#streetName >> nth2=2/2'
    expect(parseScopedSelector(unknown)).toBeNull()
    expect(resolveTarget(unknown).status).toBe('invalid')
    expect((await probe([unknown]))[0].found).toBe(false)
    expect(await run(await cmd(unknown, 'Test Road'))).toMatchObject({ outcome: 'failed' })
    expect(Array.from(document.querySelectorAll('[id="streetName"]')).map(value)).toEqual(['', ''])
  })
})

// Headings verified live 2026-10-21 on draft 4989734: Section B shows
// "Child 1" and not "Siblings 1"; Section C shows "Section C: Siblings" and
// "Siblings 1" and not "Child 1"; the side navigation names both sections.
describe('IMM 5406 sections B and C: the same row ids, told apart by the first row’s heading', () => {
  const NAV = '<nav><a>Section A</a><a>Section B: Children</a><a>Section C: Siblings</a></nav>'
  const section = (heading: string) => {
    document.body.innerHTML = `${NAV}${heading}<input id="relationship0"><input id="fullName0">
      <button type="button">Add another</button>`
    const add = () => {
      const i = document.querySelectorAll('input[id^="fullName"]').length
      document.body.insertAdjacentHTML('beforeend', `<input id="relationship${i}"><input id="fullName${i}">`)
    }
    document.querySelector('button')!.addEventListener('click', add)
  }
  const CHILD = (css: string) => `${css} >> page=/\\bChild 1\\b/i >> principal >> keep`
  const SIBLING = (css: string) => `${css} >> page=/\\bSiblings? 1\\b/i >> principal >> keep`
  const principal = () => {
    at('/en/application/case/1/imm5406?pageId=page2&documentId=55')
    document.body.innerHTML = `<input type="radio" id="principalAppYes" checked disabled><input type="radio" id="principalAppNo" disabled>`
    expect(principalFormHere()).toBe(true)
  }

  it('a child is written on Section B only; the siblings page refuses it, and the reverse', async () => {
    principal()
    at('/en/application/case/1/imm5406?pageId=page4&documentId=55')
    section('<h2>Section C: Siblings</h2><h3>Siblings 1</h3>')
    expect(await run(await cmd(CHILD('#fullName0'), 'Test Child'))).toMatchObject({ outcome: 'failed', reason: 'selector_missing' })
    expect((await run(await cmd(SIBLING('#fullName0'), 'Test Brother'))).outcome).toBe('verified')
    at('/en/application/case/1/imm5406?pageId=page3&documentId=55')
    section('<h2>Section B: Children</h2><h3>Child 1</h3>')
    expect(await run(await cmd(SIBLING('#fullName0'), 'Test Brother'))).toMatchObject({ outcome: 'failed', reason: 'selector_missing' })
    expect((await run(await cmd(CHILD('#fullName0'), 'Test Child'))).outcome).toBe('verified')
    // Rows are added on the right section only.
    expect((await run(await cmd(CHILD('#relationship1').replace(' >> keep', ''), 'Child row 2', 'row_add'))).outcome).toBe('verified')
    expect(document.querySelectorAll('input[id^="fullName"]').length).toBe(2)
  })

  it("never on a dependant's form (Section A not the principal's)", async () => {
    at('/en/application/case/1/imm5406?pageId=page2&documentId=66')
    document.body.innerHTML = `<input type="radio" id="principalAppYes" disabled><input type="radio" id="principalAppNo" checked disabled>`
    expect(principalFormHere()).toBe(false)
    at('/en/application/case/1/imm5406?pageId=page3&documentId=66')
    section('<h2>Section B: Children</h2><h3>Child 1</h3>')
    expect(await run(await cmd(CHILD('#fullName0'), 'Test Child'))).toMatchObject({ outcome: 'failed', reason: 'selector_missing' })
    expect(value(document.getElementById('fullName0')!)).toBe('')
  })
})

describe('IMM 5562: sections reuse the trip ids, scoped by their own destination id', () => {
  const A = (css: string) => `body:has(#trip-destination-0) ${css}`
  const page = (destination: string) => {
    at('/en/application/case/1/imm5562?pageId=page2')
    document.body.innerHTML = `<input id="familyName"><input id="trip-from-0"><input id="${destination}0">
      <button type="button">Add another</button>`
    document.querySelector('button')!.addEventListener('click', () => {
      const i = document.querySelectorAll('input[id^="trip-from-"]').length
      document.body.insertAdjacentHTML('beforeend', `<input id="trip-from-${i}"><input id="${destination}${i}">`)
    })
  }

  it('Section A writes land on Section A; Section B’s page refuses them', async () => {
    page('sectionB-destination-')
    expect(await run(await cmd(`${A('#trip-from-0')} >> keep`, '2023/12'))).toMatchObject({ outcome: 'failed', reason: 'selector_missing' })
    expect(value(document.getElementById('trip-from-0')!)).toBe('')
    page('trip-destination-')
    expect((await run(await cmd(`${A('#trip-from-0')} >> keep`, '2023/12'))).outcome).toBe('verified')
  })

  it('rows: the guard and the add keep the section scope', async () => {
    page('trip-destination-')
    expect((await run(await cmd(`${A('#trip-from-0')} >> rows=2`, 'Your trip: 2 rows', 'row_add'))).outcome).toBe('verified')
    expect((await run(await cmd(A('#trip-from-1'), 'Your trip row 2', 'row_add'))).outcome).toBe('verified')
    expect(document.querySelectorAll('input[id^="trip-from-"]').length).toBe(2)
    expect((await run(await cmd(`${A('#trip-destination-1')} >> keep`, 'Dubai, United Arab Emirates'))).outcome).toBe('verified')
    // A third row on the page: more than the data, the section is refused.
    document.querySelector('button')!.click()
    expect(await run(await cmd(`${A('#trip-from-0')} >> rows=2`, 'Your trip: 2 rows', 'row_add'))).toMatchObject({
      outcome: 'failed',
      reason: 'unsafe_target',
    })
  })
})
