/**
 * @jest-environment-options {"url": "https://prson-srpel.apps.cic.gc.ca/en/application/case/4989734"}
 */
/// <reference types="chrome" />
declare function require(id: string): unknown
import { deliver, installChromeMock, type ChromeMock } from './chrome-mock'
import { hashValue, normalizeValue } from '../src/readback-engine'
import { PORTAL_FILL_PROTOCOL_VERSION, type PortalFillFile, type PortalFillWriteCommand } from '../src/shared'
import {
  findUploadInput,
  inputAccepts,
  onUploadPage,
  prAttachmentShows,
  prAttachmentState,
  requiredUploads,
  slotHasFile,
} from '../src/executor/file-attach'
import { dependantForm, parseScopedSelector, resolveTarget } from '../src/executor/resolve-target'
import { isSafeDependantAddButton, isSafeDependantSave } from '../src/executor/safety-guards'
import { DEPENDANT_ADD, DEPENDANT_SAVE, findDependantAddButton } from '../src/executor/control-actuator'

/**
 * IRCC Permanent Residence Portal, recorded live 2026-10-20 (fictional data):
 *  - the application (case) page holds PDF forms, supporting documents and
 *    the fee; every table is rendered in 2–3 copies for screen widths, only
 *    one shown, ids repeated across copies and rows;
 *  - the profile adds a dependant through an inline form whose date of birth
 *    reuses the principal's own id.
 */

// jsdom has File but no DataTransfer.
class FakeDataTransfer {
  private list: File[] = []
  items = { add: (f: File) => this.list.push(f) }
  get files(): FileList {
    const l = this.list
    return Object.assign([...l], { item: (i: number) => l[i] ?? null }) as unknown as FileList
  }
}
;(globalThis as any).DataTransfer = FakeDataTransfer

const PDF_TEXT = '%PDF-1.4 test'
let PDF_SHA = ''
beforeAll(async () => {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(PDF_TEXT))
  PDF_SHA = Array.from(new Uint8Array(d))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
})
const makeFile = (name = 'passport.pdf', mimeType = 'application/pdf'): PortalFillFile => ({
  name,
  mimeType,
  size: PDF_TEXT.length,
  sha256: PDF_SHA,
  base64: btoa(PDF_TEXT),
})

const h = (v: string) => hashValue(normalizeValue(v))
async function cmd(
  selector: string,
  mappedValue: string,
  op?: PortalFillWriteCommand['op'],
  over: Partial<PortalFillWriteCommand> = {},
): Promise<PortalFillWriteCommand> {
  return {
    protocol: PORTAL_FILL_PROTOCOL_VERSION,
    kind: 'write',
    executionId: 'exec-1',
    fieldKey: 'k',
    selector,
    mappedValue,
    expectedValueHash: await h(mappedValue),
    ...(op ? { op } : {}),
    ...over,
  }
}

let mock: ChromeMock
const run = (command: PortalFillWriteCommand, ms = 12000) =>
  deliver(mock.listeners.onMessage, { type: 'execute-field-intent', command }, undefined, ms) as Promise<{
    outcome: string
    reason?: string
  }>
const probe = (selectors: string[], ops: Array<PortalFillWriteCommand['op'] | null>) =>
  deliver(mock.listeners.onMessage, { type: 'readback', selectors, ops }, undefined, 2000) as Promise<
    Array<{ selector: string; found: boolean; ambiguous?: boolean }>
  >

function loadContent() {
  mock = installChromeMock()
  jest.isolateModules(() => {
    require('../src/content')
  })
}

// ── the case page ───────────────────────────────────────────────────────────

const uploadCell = (id: string, accept = 'application/pdf, image/jpeg, image/png') =>
  `<td><lib-file-upload id="${id}"><button type="button" class="btn btn-primary-alt"> Upload </button>` +
  `<input type="file" tabindex="-1" id="${id}-input" accept="${accept}"></lib-file-upload></td>`

const SUPPORTING = [
  'Travel documents and passports',
  'Police certificates and clearances',
  'Photo(s)',
  'Birth Certificates',
  'Proof of Status',
]

/** One copy of each table; `shown` false = a responsive copy that is not rendered. */
function copy(shown: boolean, attached: Record<string, string> = {}): string {
  const style = shown ? '' : ' style="display:none"'
  const pdf = (form: string, title: string, required: boolean) =>
    `<tr><td>${required ? '* ' : ''}${form} ${required ? '(required)' : ''} <a href="#">Download</a> ${title}</td>` +
    `<td class="documents-upload-table__attachment"></td>${uploadCell(form.replace(' ', '').toLowerCase(), 'application/pdf')}</tr>`
  const doc = (name: string) =>
    `<tr><td class="documents-upload-table__name"><span> ${name}</span> (required)</td>` +
    `<td class="documents-upload-table__attachment">${attached[name] ?? ''}</td>${uploadCell('supporting-documents')}</tr>`
  return `
    <div class="copy" data-shown="${shown}"${style}>
      <h3>PDF forms</h3>
      <table><tbody>
        ${pdf('IMM 1344', 'Application to Sponsor, Sponsorship Agreement and Undertaking', true)}
        ${pdf('IMM 5532', 'Relationship Information and Sponsorship Evaluation Form', false)}
        ${pdf('IMM 5533', 'Document Checklist: Spousal Sponsorship (Including Dependent Children)', false)}
      </tbody></table>
      <h3>Supporting documents</h3>
      <label for="supporting-documents-input">Travel documents and passports</label>
      <table><tbody>${SUPPORTING.map(doc).join('')}</tbody></table>
      <h3>Fee</h3>
      <table><tbody><tr><td>* Proof of payment (required) Visit the link below and follow these instructions to pay your fees.
        <a href="#">Pay your fees</a></td><td class="documents-upload-table__attachment">${attached.payment ?? ''}</td>
        ${uploadCell('proof-of-payment')}</tr></tbody></table>
      <h3>Additional supporting documents</h3>
      <table><tbody><tr><td></td>${uploadCell('additional-documents')}</tr></tbody></table>
    </div>`
}

/**
 * `listsUpload`: the page lists a chosen file's name in its row's
 * attachment cell, as IRCC presumably does (never recorded: review B1).
 */
function casePage(attached: Record<string, string> = {}, path = '/en/application/case/4989734', listsUpload = true) {
  window.history.replaceState(null, '', path)
  // Two hidden copies around the one shown, as IRCC renders them.
  document.body.innerHTML = `<main>${copy(false, attached)}${copy(true, attached)}${copy(false, attached)}
    <h3>Consent and declaration</h3><button type="button">Consent and declaration</button></main>`
  for (const el of Array.from(document.querySelectorAll('input[type=file]'))) {
    let files: FileList | null = null
    Object.defineProperty(el, 'files', { get: () => files, set: (v) => (files = v), configurable: true })
    if (listsUpload)
      el.addEventListener('change', () => {
        const cell = el.closest('tr')?.querySelector('.documents-upload-table__attachment')
        const f = (el as HTMLInputElement).files?.[0]
        if (cell && f) cell.textContent = f.name
      })
  }
}
const shownCopy = () => document.querySelector('.copy[data-shown="true"]')!

describe('PR case page: finding the visible slot', () => {
  beforeEach(() => casePage())

  it('is an upload page at its exact path only', () => {
    expect(onUploadPage('/en/application/case/4989734')).toBe(true)
    expect(onUploadPage('/en/application/case/4989734/')).toBe(true)
    expect(onUploadPage('/en/application/case/4989734/imm5406')).toBe(false)
    expect(onUploadPage('/en/application/case/4989734/imm0008/page3')).toBe(false)
    expect(onUploadPage('/en/application/profile/4989734')).toBe(false)
    expect(findUploadInput('::upload:proof of status', '/en/application/case/4989734/imm5406').status).toBe('wrong_page')
  })

  it.each([
    ['\\bIMM ?1344\\b', 'imm1344-input'],
    ['\\bIMM ?5532\\b', 'imm5532-input'],
    ['\\bIMM ?5533\\b', 'imm5533-input'],
    ['travel documents and passports', 'supporting-documents-input'],
    ['police certificates', 'supporting-documents-input'],
    ['\\bphoto\\(s\\)', 'supporting-documents-input'],
    ['birth certificates?', 'supporting-documents-input'],
    ['proof of status', 'supporting-documents-input'],
    ['proof of payment', 'proof-of-payment-input'],
  ])('%s → one input, in the copy that is shown', (pattern, id) => {
    const t = findUploadInput(`::upload:${pattern}`)
    if (t.status !== 'found') throw new Error(`${pattern}: ${t.status}`)
    expect(t.input.id).toBe(id)
    expect(shownCopy().contains(t.input)).toBe(true)
    // The row is the input's own table row, not its whole table.
    expect(t.row.tagName).toBe('TR')
  })

  it('a label for a repeated id does not name every row', () => {
    // <label for="supporting-documents-input">Travel documents…</label> would
    // otherwise make all five rows (and copies) match "passport".
    const t = findUploadInput('::upload:police certificates')
    expect(t.status).toBe('found')
    expect(findUploadInput('::upload:travel documents and passports').status).toBe('found')
  })

  it('with a layout engine, a row with no client rects is not a slot', () => {
    // Make every copy "rendered" by CSS, and decide by client rects as Chrome does.
    for (const c of Array.from(document.querySelectorAll('.copy'))) c.removeAttribute('style')
    const rects = jest.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
      const shown = this === document.documentElement || this.closest('.copy')?.getAttribute('data-shown') === 'true'
      return (shown ? [{}] : []) as unknown as DOMRectList
    })
    try {
      const t = findUploadInput('::upload:proof of status')
      expect(t.status === 'found' && shownCopy().contains(t.input)).toBe(true)
    } finally {
      rects.mockRestore()
    }
    // Without that check every copy would match: ambiguous, never a guess.
    expect(findUploadInput('::upload:proof of status').status).toBe('ambiguous')
  })

  it('an attachment cell that names a file is an uploaded slot; an empty one is not', () => {
    casePage({ 'Proof of Status': '<a href="#">status.pdf</a>', payment: 'receipt.pdf' })
    const status = findUploadInput('::upload:proof of status')
    const police = findUploadInput('::upload:police certificates')
    const pay = findUploadInput('::upload:proof of payment')
    if (status.status !== 'found' || police.status !== 'found' || pay.status !== 'found') throw new Error('slots')
    expect(slotHasFile(status.input, status.row)).toBe(true)
    expect(slotHasFile(pay.input, pay.row)).toBe(true)
    expect(slotHasFile(police.input, police.row)).toBe(false)
  })

  it("the input's own accept list decides the format (PDF forms: PDF only)", () => {
    const t = findUploadInput('::upload:\\bIMM ?1344\\b')
    if (t.status !== 'found') throw new Error('slot')
    expect(inputAccepts(t.input, { name: 'imm1344.pdf', mimeType: 'application/pdf' })).toBe(true)
    expect(inputAccepts(t.input, { name: 'imm1344.jpg', mimeType: 'image/jpeg' })).toBe(false)
  })

  it('required rows for the panel: the visible copy once, by name', () => {
    casePage({ 'Proof of Status': 'status.pdf' })
    expect(requiredUploads()).toEqual([
      { name: 'IMM 1344', uploaded: false },
      { name: 'Travel documents and passports', uploaded: false },
      { name: 'Police certificates and clearances', uploaded: false },
      { name: 'Photo(s)', uploaded: false },
      { name: 'Birth Certificates', uploaded: false },
      { name: 'Proof of Status', uploaded: true },
      { name: 'Proof of payment', uploaded: false },
    ])
  })
})

describe('TRV /doc-upload is unchanged', () => {
  it('an "attachment" element there is not a file (the PR-only check)', () => {
    window.history.replaceState(null, '', '/doc-upload')
    document.body.innerHTML = `<div><span>Passport (required)</span><div class="attachment-hint">Max 5 MB</div>
      <input type="file" id="req_upload1_file_input"></div>`
    const t = findUploadInput('::upload:\\bpassport\\b')
    if (t.status !== 'found') throw new Error('slot')
    expect(slotHasFile(t.input, t.row)).toBe(false)
  })
})

describe('PR case page: attach_file through the content script', () => {
  beforeEach(() => {
    casePage()
    loadContent()
  })
  const attach = async (pattern: string, file = makeFile(), over: Partial<PortalFillWriteCommand> = {}) =>
    run(
      await cmd(`::upload:${pattern}`, `${file.name} [doc:00000000-0000-4000-8000-000000000002]`, 'attach_file', {
        file,
        ...over,
      }),
    )

  it('puts the file on the visible row only; the hidden copies are untouched', async () => {
    expect((await attach('travel documents and passports')).outcome).toBe('verified')
    const row = Array.from(shownCopy().querySelectorAll('tr')).find((r) => /Travel documents/.test(r.textContent ?? ''))!
    expect(row.querySelector('.documents-upload-table__attachment')!.textContent).toBe('passport.pdf')
    const inputs = Array.from(document.querySelectorAll('#supporting-documents-input')) as HTMLInputElement[]
    const holding = inputs.filter((i) => (i.files?.length ?? 0) > 0)
    expect(holding).toHaveLength(1)
    expect(shownCopy().contains(holding[0])).toBe(true)
    expect(holding[0].closest('tr')!.textContent).toContain('Travel documents and passports')
  })

  it('the fee RECEIPT goes in the proof-of-payment row; nothing is clicked', async () => {
    const clicks: string[] = []
    document.addEventListener('click', (e) => clicks.push((e.target as Element).textContent ?? ''), true)
    expect((await attach('proof of payment', makeFile('receipt.pdf'))).outcome).toBe('verified')
    expect(clicks).toEqual([])
  })

  it('a format the slot does not accept is refused before anything is set', async () => {
    const r = await attach('\\bIMM ?1344\\b', makeFile('imm1344.jpg', 'image/jpeg'))
    expect(r).toMatchObject({ outcome: 'failed', reason: 'controlled_rejected' })
    for (const i of Array.from(document.querySelectorAll('#imm1344-input')) as HTMLInputElement[])
      expect(i.files).toBeNull()
  })

  it('a row whose attachment cell is not empty is refused (never read as empty, never replaced)', async () => {
    for (const shown of ['photo.jpg', '<span class="icon"></span>', ' ✓ ']) {
      casePage({ 'Photo(s)': shown })
      expect(await attach('\\bphoto\\(s\\)', makeFile('photo.pdf'))).toMatchObject({
        outcome: 'failed',
        reason: 'unsafe_target',
      })
      for (const i of Array.from(document.querySelectorAll('#supporting-documents-input')) as HTMLInputElement[])
        expect(i.files).toBeNull()
    }
  })

  it('a row with no attachment cell is refused', async () => {
    for (const c of Array.from(document.querySelectorAll('.documents-upload-table__attachment')))
      c.classList.remove('documents-upload-table__attachment')
    expect(await attach('police certificates')).toMatchObject({ outcome: 'failed', reason: 'unsafe_target' })
    for (const i of Array.from(document.querySelectorAll('#supporting-documents-input')) as HTMLInputElement[])
      expect(i.files).toBeNull()
  })

  it('success is the attachment cell naming the file', () => {
    casePage({ 'Proof of Status': 'status.pdf' })
    const t = findUploadInput('::upload:proof of status')
    if (t.status !== 'found') throw new Error('slot')
    expect(prAttachmentShows(t.row, 'status.pdf')).toBe(true)
    expect(prAttachmentShows(t.row, 'other.pdf')).toBe(false)
    expect(prAttachmentState(t.row)).toBe('filled')
    const p = findUploadInput('::upload:police certificates')
    expect(p.status === 'found' && prAttachmentState(p.row)).toBe('empty')
  })

  it('the probe finds one slot per pattern', async () => {
    const res = await probe(['::upload:proof of status', '::upload:(required)'], ['attach_file', 'attach_file'])
    expect(res[0].found).toBe(true)
    expect(res[1]).toMatchObject({ found: false, ambiguous: true })
  })
})

// ── the profile: "Add dependant" ────────────────────────────────────────────

const PRINCIPAL_DOB = '1989/11/22'

/** The profile page: the principal's own fields, the dependants section and its behaviour. */
function profilePage(opts: { cards?: string[]; neverValid?: boolean } = {}) {
  window.history.replaceState(null, '', '/en/application/profile/4989734')
  const card = (name: string, dob: string, relationship = 'Child', accompanying = 'Yes') =>
    `<pra-dependant-card><div class="card"><div class="card__body"><section><h5> Accompanying </h5><p> ${accompanying} </p>` +
    `<h5> Relationship </h5><p> ${relationship} </p><h5> Name </h5><p>${name}</p><h5> Date of birth </h5><p> ${dob} </p>` +
    `<button type="button"> Edit </button><button type="button"> Delete </button></section></div></div></pra-dependant-card>`
  document.body.innerHTML = `
    <form id="profile">
      <h2>Personal details</h2>
      <input id="profileForm-familyName" value="EXAMPLE">
      <input id="personalDetailsForm-givenName" value="TEST APPLICANT">
      <input id="personalDetailsForm-dob" value="${PRINCIPAL_DOB}" placeholder="____/__/__">
      <h2>Spouse, partner or dependant(s) profiles</h2>
      <div id="dependants"></div>
      <button category="secondary" type="button"> Add dependant </button>
      <h3>Saved dependants</h3>
      <div id="cards">${(opts.cards ?? []).join('')}</div>
      <button type="submit">Save and continue</button>
    </form>`
  const box = document.getElementById('dependants')!
  const add = document.querySelector('button[category="secondary"]') as HTMLButtonElement
  add.addEventListener('click', () => {
    box.innerHTML = `
      <div class="dependant-form">
        <fieldset><legend>Is the dependant accompanying you?</legend>
          <input type="radio" id="dependantYes" name="dependants" value="Y"><label for="dependantYes">Yes</label>
          <input type="radio" id="dependantNo" name="dependants" value="N"><label for="dependantNo">No</label></fieldset>
        <label for="dependantForm-relationship">Relationship</label>
        <select id="dependantForm-relationship">
          <option value="0: null">Select</option><option value="87">Adopted Child</option><option value="02">Child</option>
          <option value="01">Common-Law Partner</option><option value="10">Spouse</option><option value="03">Step-Child</option>
        </select>
        <input id="dependantForm-familyName"><input id="dependantForm-givenName">
        <input id="personalDetailsForm-dob" placeholder="____/__/__">
        <button type="button" disabled>Save details</button>
        <button type="button">Cancel</button>
        <button type="submit">See errors or missing information above</button>
      </div>`
    const form = box.querySelector('.dependant-form')!
    const save = form.querySelector('button[disabled]') as HTMLButtonElement
    const val = (id: string) => (form.querySelector(`#${id}`) as HTMLInputElement).value
    const check = () => {
      save.disabled =
        !!opts.neverValid ||
        !(form.querySelector('#dependantYes:checked, #dependantNo:checked') && val('dependantForm-relationship') !== '0: null' &&
          val('dependantForm-familyName') && val('dependantForm-givenName') && /^\d{4}\/\d{2}\/\d{2}$/.test(val('personalDetailsForm-dob')))
    }
    form.addEventListener('input', check)
    form.addEventListener('change', check)
    save.addEventListener('click', () => {
      const name = `${val('dependantForm-givenName')} ${val('dependantForm-familyName')}`
      const dob = val('personalDetailsForm-dob')
      const sel = form.querySelector('#dependantForm-relationship') as HTMLSelectElement
      const rel = sel.options[sel.selectedIndex].text
      const acc = form.querySelector('#dependantYes:checked') ? 'Yes' : 'No'
      box.innerHTML = ''
      document.getElementById('cards')!.insertAdjacentHTML('beforeend', card(name, dob, rel, acc))
    })
  })
  return { add, card }
}

const summary = (given: string, family: string, dob: string, accompanying = 'Yes') =>
  `Name: ${given} ${family}; Family name: ${family}; Date of birth: ${dob}; Relationship: Child; Accompanying: ${accompanying}`
const SUMMARY = summary('TEST CHILD', 'EXAMPLE', '2024/07/06')
const D = (css: string) => `${css} >> dependant`
async function dependantSteps(given = 'TEST CHILD', family = 'EXAMPLE', dob = '2024/07/06'): Promise<PortalFillWriteCommand[]> {
  const value = summary(given, family, dob)
  return [
    await cmd(DEPENDANT_ADD, value, 'dependant_open', { reveal: true }),
    await cmd(D('#dependantYes'), 'Yes', 'radio', { reveal: true }),
    await cmd(`${D('#dependantForm-relationship')} >> option=text:Child`, 'Child', 'select_text', { reveal: true }),
    await cmd(D('#dependantForm-familyName'), family, undefined, { reveal: true }),
    await cmd(D('#dependantForm-givenName'), given, undefined, { reveal: true }),
    await cmd(D('#personalDetailsForm-dob'), dob, undefined, { reveal: true }),
    await cmd(DEPENDANT_SAVE, value, 'dependant_save', { reveal: true }),
  ]
}
const principalDob = () => (document.querySelectorAll('#personalDetailsForm-dob')[0] as HTMLInputElement).value

describe('`>> dependant`: inside the open inline dependant form only', () => {
  it('parses as a scope part', () => {
    expect(parseScopedSelector('#a >> dependant')).toEqual({ css: '#a', dependant: true })
    expect(parseScopedSelector('#a >> dependant >> option=text:Child')).toMatchObject({ dependant: true })
    expect(parseScopedSelector('#a >> dependant >> dependant')).toBeNull()
  })

  it('no open form: nothing resolves; open: the dependant DOB, never the principal one', () => {
    const { add } = profilePage()
    expect(resolveTarget(D('#personalDetailsForm-dob')).status).toBe('missing')
    expect(resolveTarget('#personalDetailsForm-dob').status).toBe('found')
    add.click()
    const t = resolveTarget(D('#personalDetailsForm-dob'))
    expect(t.status === 'found' && (t.el as HTMLInputElement).value).toBe('')
    expect(t.status === 'found' && dependantForm()!.contains(t.el)).toBe(true)
    // The plain id now names two fields: refused, never the first match.
    expect(resolveTarget('#personalDetailsForm-dob').status).toBe('ambiguous')
  })

  it('a block that also holds the principal fields is not the dependant form', () => {
    window.history.replaceState(null, '', '/en/application/profile/4989734')
    document.body.innerHTML = `<form><input id="personalDetailsForm-givenName"><input id="personalDetailsForm-dob">
      <select id="dependantForm-relationship"></select><button type="button">Save details</button></form>`
    expect(dependantForm()).toBeNull()
    expect(resolveTarget(D('#personalDetailsForm-dob')).status).toBe('missing')
  })
})

describe('the dependant guards', () => {
  it('"Add dependant": that exact button on the profile only', () => {
    const { add } = profilePage()
    expect(isSafeDependantAddButton(add)).toBe(true)
    for (const text of ['Edit', 'Delete', 'Cancel', 'Save and continue', 'Add another', 'Add dependant now']) {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = text
      document.body.appendChild(b)
      expect([text, isSafeDependantAddButton(b)]).toEqual([text, false])
    }
    const submit = document.createElement('button')
    submit.type = 'submit'
    submit.textContent = 'Add dependant'
    document.body.appendChild(submit)
    expect(isSafeDependantAddButton(submit)).toBe(false)
    // A submit "Add dependant" is not a candidate: still exactly one.
    expect(findDependantAddButton()).toMatchObject({ done: true })
    const dlg = document.createElement('div')
    dlg.setAttribute('role', 'dialog')
    dlg.innerHTML = '<button type="button">Add dependant</button>'
    document.body.appendChild(dlg)
    expect(isSafeDependantAddButton(dlg.querySelector('button')!)).toBe(false)
    add.disabled = true
    expect(isSafeDependantAddButton(add)).toBe(false)
    add.disabled = false
    window.history.replaceState(null, '', '/en/application/case/4989734')
    expect(isSafeDependantAddButton(add)).toBe(false)
  })

  it('"Save details": enabled, type=button, inside the open dependant form', () => {
    const { add } = profilePage()
    add.click()
    const form = dependantForm()!
    const save = Array.from(form.querySelectorAll('button')).find((b) => b.textContent === 'Save details')!
    expect(isSafeDependantSave(save, form)).toBe(false) // disabled until valid
    save.disabled = false
    expect(isSafeDependantSave(save, form)).toBe(true)
    for (const b of Array.from(document.querySelectorAll('button')).filter((x) => x !== save))
      expect([b.textContent?.trim(), isSafeDependantSave(b, form)]).toEqual([b.textContent?.trim(), false])
    const outside = document.createElement('button')
    outside.type = 'button'
    outside.textContent = 'Save details'
    document.body.appendChild(outside)
    expect(isSafeDependantSave(outside, form)).toBe(false)
  })
})

describe('adding a dependant through the content script', () => {
  beforeEach(() => loadContent())

  it('opens the form, fills it, saves it: the card appears, the principal DOB is untouched', async () => {
    profilePage()
    for (const c of await dependantSteps()) expect([c.selector, (await run(c)).outcome]).toEqual([c.selector, 'verified'])
    expect(principalDob()).toBe(PRINCIPAL_DOB)
    expect(dependantForm()).toBeNull()
    const cards = document.querySelectorAll('pra-dependant-card')
    expect(cards).toHaveLength(1)
    expect(cards[0].textContent).toContain('TEST CHILD EXAMPLE')
    expect(cards[0].textContent).toContain('2024/07/06')
  })

  it('a dependant whose card is saved is not added again: nothing clicked, nothing written', async () => {
    const { add, card } = profilePage()
    document.getElementById('cards')!.innerHTML = card('TEST CHILD EXAMPLE', '2024/07/06')
    const clicked = jest.fn()
    add.addEventListener('click', clicked)
    for (const c of await dependantSteps()) expect((await run(c)).outcome).toBe('verified')
    expect(clicked).not.toHaveBeenCalled()
    expect(document.querySelectorAll('pra-dependant-card')).toHaveLength(1)
    expect(principalDob()).toBe(PRINCIPAL_DOB)
  })

  it('another child with the same family name is a different dependant', async () => {
    const { card } = profilePage()
    document.getElementById('cards')!.innerHTML = card('TEST OTHER EXAMPLE', '2022/01/01')
    for (const c of await dependantSteps()) expect((await run(c)).outcome).toBe('verified')
    expect(document.querySelectorAll('pra-dependant-card')).toHaveLength(2)
  })

  it('a Save details that stays disabled is never clicked', async () => {
    profilePage({ neverValid: true })
    const steps = await dependantSteps()
    for (const c of steps.slice(0, -1)) expect((await run(c)).outcome).toBe('verified')
    const save = Array.from(dependantForm()!.querySelectorAll('button')).find((b) => b.textContent === 'Save details')!
    const clicked = jest.fn()
    save.addEventListener('click', clicked)
    expect(await run(steps[steps.length - 1])).toMatchObject({ outcome: 'failed', reason: 'controlled_rejected' })
    expect(clicked).not.toHaveBeenCalled()
    expect(document.querySelectorAll('pra-dependant-card')).toHaveLength(0)
    expect(principalDob()).toBe(PRINCIPAL_DOB)
  })

  it('a dependant form already open with values is refused: nothing clicked, nothing changed', async () => {
    const { add } = profilePage()
    add.click()
    ;(document.querySelector('#dependantForm-familyName') as HTMLInputElement).value = 'SOMEONE'
    const clicked = jest.fn()
    add.addEventListener('click', clicked)
    const [open] = await dependantSteps()
    expect(await run(open)).toMatchObject({ outcome: 'failed', reason: 'unsafe_target' })
    expect(clicked).not.toHaveBeenCalled()
    expect((document.querySelector('#dependantForm-familyName') as HTMLInputElement).value).toBe('SOMEONE')
  })

  it('an empty dependant form already open is used as it is (no second click)', async () => {
    const { add } = profilePage()
    add.click()
    const clicked = jest.fn()
    add.addEventListener('click', clicked)
    for (const c of await dependantSteps()) expect((await run(c)).outcome).toBe('verified')
    expect(clicked).not.toHaveBeenCalled()
    expect(document.querySelectorAll('pra-dependant-card')).toHaveLength(1)
  })

  it('the open step names only its own pseudo-selector', async () => {
    profilePage()
    expect(await run(await cmd('button[category="secondary"]', SUMMARY, 'dependant_open'))).toMatchObject({
      outcome: 'failed',
      reason: 'unsafe_target',
    })
    expect(dependantForm()).toBeNull()
  })

  it('the probe: "Add dependant" is there; Save details is not until the form opens', async () => {
    profilePage()
    const res = await probe([DEPENDANT_ADD, DEPENDANT_SAVE], ['dependant_open', 'dependant_save'])
    expect(res.map((r) => r.found)).toEqual([true, false])
  })
})

describe('review S1: the dependant form never holds the principal date of birth', () => {
  it('a block holding the first #personalDetailsForm-dob, or two of them, is not the form', () => {
    window.history.replaceState(null, '', '/en/application/profile/4989734')
    // The principal DOB sits inside the block that holds the dependant fields.
    document.body.innerHTML = `<div id="principal"><input id="personalDetailsForm-dob" value="${PRINCIPAL_DOB}">
      <div><select id="dependantForm-relationship"></select><input id="personalDetailsForm-dob"></div>
      <button type="button">Save details</button></div>`
    expect(dependantForm()).toBeNull()
    expect(resolveTarget(D('#personalDetailsForm-dob')).status).toBe('missing')
  })

  it('with only one #personalDetailsForm-dob on the page, a dependant DOB write is refused', async () => {
    loadContent()
    window.history.replaceState(null, '', '/en/application/profile/4989734')
    document.body.innerHTML = `<div class="dependant-form"><select id="dependantForm-relationship"></select>
      <input id="personalDetailsForm-dob"><button type="button">Save details</button></div>`
    // Its one DOB is the page's first: not taken for the dependant form, and
    // resolve-target also refuses a dependant DOB with fewer than two on the page.
    expect(dependantForm()).toBeNull()
    expect(resolveTarget(D('#personalDetailsForm-dob')).status).not.toBe('found')
    expect(await run(await cmd(D('#personalDetailsForm-dob'), '2024/07/06'))).toMatchObject({ outcome: 'failed' })
    expect((document.querySelector('#personalDetailsForm-dob') as HTMLInputElement).value).toBe('')
  })
})

describe('review S2: saved cards are matched field by field', () => {
  beforeEach(() => loadContent())

  it('twins: "ALI KHAN" saved, "ALI REZA KHAN" born the same day is refused before any click', async () => {
    const { add, card } = profilePage()
    document.getElementById('cards')!.innerHTML = card('ALI KHAN', '2015/03/04')
    const clicked = jest.fn()
    add.addEventListener('click', clicked)
    const [open] = await dependantSteps('ALI REZA', 'KHAN', '2015/03/04')
    expect(await run(open)).toMatchObject({ outcome: 'failed', reason: 'unsafe_target' })
    expect(clicked).not.toHaveBeenCalled()
  })

  it('and the other way round: "ALI REZA KHAN" saved does not count as "ALI KHAN"', async () => {
    const { add, card } = profilePage()
    document.getElementById('cards')!.innerHTML = card('ALI REZA KHAN', '2015/03/04')
    const clicked = jest.fn()
    add.addEventListener('click', clicked)
    const [open] = await dependantSteps('ALI', 'KHAN', '2015/03/04')
    expect(await run(open)).toMatchObject({ outcome: 'failed', reason: 'unsafe_target' })
    expect(clicked).not.toHaveBeenCalled()
  })

  it('a card with the same name but another date of birth is a different child', async () => {
    const { card } = profilePage()
    document.getElementById('cards')!.innerHTML = card('ALI REZA KHAN', '2016/01/01')
    for (const c of await dependantSteps('ALI REZA', 'KHAN', '2015/03/04')) expect((await run(c)).outcome).toBe('verified')
    expect(document.querySelectorAll('pra-dependant-card')).toHaveLength(2)
  })

  it('any other card with the same date of birth is refused, whatever its name order', async () => {
    const { add, card } = profilePage()
    const clicked = jest.fn()
    add.addEventListener('click', clicked)
    for (const other of ['KHAN, ALI REZA', 'ALI REZA SMITH']) {
      document.getElementById('cards')!.innerHTML = card(other, '2015/03/04')
      const [first] = await dependantSteps('ALI REZA', 'KHAN', '2015/03/04')
      expect((await run(first)).outcome).not.toBe('verified')
    }
    expect(clicked).not.toHaveBeenCalled()
  })

  it('dates match across separators and case/spacing does not count', async () => {
    const { add, card } = profilePage()
    document.getElementById('cards')!.innerHTML = card('  test   child example ', '2024-07-06')
    const clicked = jest.fn()
    add.addEventListener('click', clicked)
    for (const c of await dependantSteps()) expect((await run(c)).outcome).toBe('verified')
    expect(clicked).not.toHaveBeenCalled()
    expect(document.querySelectorAll('pra-dependant-card')).toHaveLength(1)
  })

  it('same name and date but another accompanying answer: stopped, not claimed done', async () => {
    const { add, card } = profilePage()
    document.getElementById('cards')!.innerHTML = card('TEST CHILD EXAMPLE', '2024/07/06', 'Child', 'No')
    const clicked = jest.fn()
    add.addEventListener('click', clicked)
    const [open] = await dependantSteps()
    expect(await run(open)).toMatchObject({ outcome: 'failed', reason: 'value_mismatch' })
    expect(clicked).not.toHaveBeenCalled()
  })

  it('a value that is not a reviewed dependant is refused', async () => {
    profilePage()
    expect(await run(await cmd(DEPENDANT_ADD, 'TEST CHILD EXAMPLE born 2024/07/06', 'dependant_open'))).toMatchObject({
      outcome: 'failed',
      reason: 'unsafe_target',
    })
    expect(dependantForm()).toBeNull()
  })
})
