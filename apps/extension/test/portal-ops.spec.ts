/// <reference types="chrome" />
declare function require(id: string): unknown
import { deliver, installChromeMock, type ChromeMock } from './chrome-mock'
import { hashValue, normalizeValue } from '../src/readback-engine'
import { PORTAL_FILL_PROTOCOL_VERSION, type PortalFillWriteCommand } from '../src/shared'
import { chooseRadio, ensureChecked, findDialogSave, openRowDialog } from '../src/executor/control-actuator'
import { executeSelectByText, executeWrite } from '../src/executor/field-executor'

/**
 * The operations IRCC's tr-rt pages need beyond typing a value (selectors and
 * behaviour recorded live 2026-10-15): radio answers, checkbox ticks, options
 * chosen by their text, follow-up questions that appear only after their
 * parent radio is answered, and table rows added through a mat-dialog. Every
 * step is still read back and verified against the server's hash.
 */

const h = (v: string) => hashValue(normalizeValue(v))

async function cmd(over: Partial<PortalFillWriteCommand> & { selector: string; mappedValue: string }): Promise<PortalFillWriteCommand> {
  return {
    protocol: PORTAL_FILL_PROTOCOL_VERSION,
    kind: 'write',
    executionId: 'exec-1',
    fieldKey: 'k',
    expectedValueHash: await h(over.mappedValue),
    ...over,
  }
}

let mock: ChromeMock
function load() {
  mock = installChromeMock()
  jest.isolateModules(() => {
    require('../src/content')
  })
}
const run = (command: PortalFillWriteCommand, ms = 8000) =>
  deliver(mock.listeners.onMessage, { type: 'execute-field-intent', command }, undefined, ms) as Promise<{
    outcome: string
    reason?: string
  }>

describe('radio answers', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <input type="radio" name="hasOtherNames" id="hasOtherNames_radio-button-01-input" />
      <input type="radio" name="hasOtherNames" id="hasOtherNames_radio-button-02-input" />`
    load()
  })

  it('clicks the answer and verifies it is selected', async () => {
    const r = await run(await cmd({ op: 'radio', selector: '#hasOtherNames_radio-button-02-input', mappedValue: 'No' }))
    expect(r.outcome).toBe('verified')
    expect((document.getElementById('hasOtherNames_radio-button-02-input') as HTMLInputElement).checked).toBe(true)
    expect((document.getElementById('hasOtherNames_radio-button-01-input') as HTMLInputElement).checked).toBe(false)
  })

  it('a radio is never written as a value (a protocol-1 style write is refused)', async () => {
    const r = await run(await cmd({ selector: '#hasOtherNames_radio-button-02-input', mappedValue: 'No' }))
    expect(r).toMatchObject({ outcome: 'failed', reason: 'unsafe_target' })
    expect((document.getElementById('hasOtherNames_radio-button-02-input') as HTMLInputElement).checked).toBe(false)
  })

  it('a radio that ends up unselected fails verification', async () => {
    const el = document.getElementById('hasOtherNames_radio-button-02-input') as HTMLInputElement
    el.addEventListener('click', (e) => e.preventDefault()) // portal refuses the click
    const r = await run(await cmd({ op: 'radio', selector: '#hasOtherNames_radio-button-02-input', mappedValue: 'No' }))
    expect(r).toMatchObject({ outcome: 'failed', reason: 'value_mismatch' })
  })

  it('chooseRadio refuses anything that is not a radio input', () => {
    document.body.innerHTML = '<input type="checkbox" id="c" /><button id="b">x</button>'
    expect(chooseRadio(document.getElementById('c')!)).toMatchObject({ done: false, reason: 'unsafe_target' })
    expect(chooseRadio(document.getElementById('b')!)).toMatchObject({ done: false })
  })
})

describe('checkboxes', () => {
  beforeEach(() => {
    document.body.innerHTML = '<input type="checkbox" id="ongoing_chk-input" />'
    load()
  })

  it('ticks an unticked box and verifies', async () => {
    const r = await run(await cmd({ op: 'check', selector: '#ongoing_chk-input', mappedValue: 'Yes' }))
    expect(r.outcome).toBe('verified')
    expect((document.getElementById('ongoing_chk-input') as HTMLInputElement).checked).toBe(true)
  })

  it('never un-ticks: an already ticked box is left ticked', () => {
    const el = document.getElementById('ongoing_chk-input') as HTMLInputElement
    el.click()
    expect(el.checked).toBe(true)
    expect(ensureChecked(el)).toMatchObject({ done: true })
    expect(el.checked).toBe(true)
  })
})

describe('options chosen by their visible text', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <select id="relationInviter_select">
        <option value="">Select</option>
        <option value="01">Family Member</option>
        <option value="02">Friend</option>
      </select>`
    load()
  })

  it('selects by text (case-folded) and verifies the shown text', async () => {
    const r = await run(await cmd({ op: 'select_text', selector: '#relationInviter_select', mappedValue: 'Family member' }))
    expect(r.outcome).toBe('verified')
    expect((document.getElementById('relationInviter_select') as HTMLSelectElement).value).toBe('01')
  })

  it('an option that does not exist writes nothing', () => {
    expect(executeSelectByText('#relationInviter_select', 'Colleague')).toMatchObject({ written: false })
    expect((document.getElementById('relationInviter_select') as HTMLSelectElement).value).toBe('')
  })
})

describe('follow-up questions revealed by an answer', () => {
  beforeEach(() => {
    document.body.innerHTML = '<input type="radio" id="areFundsShared_radio-button-01-input" name="f" />'
    const radio = document.getElementById('areFundsShared_radio-button-01-input')!
    // IRCC renders the details box only after "Yes" is chosen.
    radio.addEventListener('change', () => {
      setTimeout(() => {
        const ta = document.createElement('textarea')
        ta.id = 'detailsFunds_txtArea'
        document.body.appendChild(ta)
      }, 150)
    })
    load()
  })

  it('waits for the revealed field, then writes and verifies it', async () => {
    expect((await run(await cmd({ op: 'radio', selector: '#areFundsShared_radio-button-01-input', mappedValue: 'Yes' }))).outcome).toBe('verified')
    const r = await run(await cmd({ reveal: true, selector: '#detailsFunds_txtArea', mappedValue: 'My son pays.' }))
    expect(r.outcome).toBe('verified')
    expect((document.getElementById('detailsFunds_txtArea') as HTMLTextAreaElement).value).toBe('My son pays.')
  })

  it('a revealed field that never appears fails as missing (after the wait)', async () => {
    const r = await run(await cmd({ reveal: true, selector: '#neverThere_input', mappedValue: 'x' }), 9000)
    expect(r).toMatchObject({ outcome: 'failed', reason: 'selector_missing' })
  }, 12000)
})

describe('table rows added through a dialog', () => {
  // A minimal mat-dialog: the add button opens it; Save closes it and adds a
  // row to the table behind it, unless the country is empty (IRCC refuses).
  beforeEach(() => {
    document.body.innerHTML = `
      <main>
        <input id="lastName_input" type="text" />
        <table id="t"><tr><th>Country</th></tr></table>
        <button id="otherCountriesResidences_add_button" type="button">Add</button>
        <button id="next_path" type="button">Save and continue</button>
      </main>
      <div class="cdk-overlay-container"></div>`
    document.getElementById('otherCountriesResidences_add_button')!.addEventListener('click', () => {
      const overlay = document.querySelector('.cdk-overlay-container')!
      overlay.innerHTML = `
        <mat-dialog-container role="dialog">
          <input id="lastName_input" type="text" />
          <select id="countryOfResidence_select"><option value=""></option><option value="209">Pakistan</option></select>
          <button id="countryOfResidence_save_button" type="button">Save</button>
          <button type="button">Cancel</button>
        </mat-dialog-container>`
      document.getElementById('countryOfResidence_save_button')!.addEventListener('click', () => {
        const v = (document.getElementById('countryOfResidence_select') as HTMLSelectElement).value
        if (!v) return
        overlay.innerHTML = ''
        const tr = document.createElement('tr')
        tr.innerHTML = '<td>Pakistan</td>'
        document.getElementById('t')!.appendChild(tr)
      })
    })
    load()
  })

  it('opens, fills inside the dialog only, saves, and verifies the row was added', async () => {
    const summary = 'Pakistan — Citizen since 1980-01-01'
    expect((await run(await cmd({ op: 'dialog_open', selector: '#otherCountriesResidences_add_button', mappedValue: summary }))).outcome).toBe('verified')
    // `#lastName_input` exists on the page AND in the dialog: dialog scope picks the dialog's.
    expect((await run(await cmd({ dialog: true, selector: '#lastName_input', mappedValue: 'Khan' }))).outcome).toBe('verified')
    const inDialog = document.querySelector('mat-dialog-container #lastName_input') as HTMLInputElement
    expect(inDialog.value).toBe('Khan')
    expect((document.querySelector('main #lastName_input') as HTMLInputElement).value).toBe('')
    expect((await run(await cmd({ dialog: true, selector: '#countryOfResidence_select', mappedValue: '209' }))).outcome).toBe('verified')
    expect((await run(await cmd({ op: 'dialog_save', dialog: true, selector: '::dialog-save', mappedValue: summary }))).outcome).toBe('verified')
    expect(document.querySelectorAll('#t tr')).toHaveLength(2)
    expect(document.querySelector('mat-dialog-container')).toBeNull()
  })

  it('a Save the portal refuses (dialog stays open, no row) fails the step', async () => {
    await run(await cmd({ op: 'dialog_open', selector: '#otherCountriesResidences_add_button', mappedValue: 'row' }))
    const r = await run(await cmd({ op: 'dialog_save', dialog: true, selector: '#countryOfResidence_save_button', mappedValue: 'row' }), 9000)
    expect(r).toMatchObject({ outcome: 'failed', reason: 'controlled_rejected' })
  }, 12000)

  it('never clicks "Save and continue", whatever the selector says', async () => {
    let clicked = false
    document.getElementById('next_path')!.addEventListener('click', () => (clicked = true))
    expect(openRowDialog(document.getElementById('next_path')!)).toMatchObject({ done: false, reason: 'unsafe_target' })
    const r = await run(await cmd({ op: 'dialog_open', selector: '#next_path', mappedValue: 'x' }))
    expect(r).toMatchObject({ outcome: 'failed', reason: 'unsafe_target' })
    expect(clicked).toBe(false)
  })

  it('the dialog Save is only ever a button inside the dialog that says Save', async () => {
    await run(await cmd({ op: 'dialog_open', selector: '#otherCountriesResidences_add_button', mappedValue: 'row' }))
    expect(findDialogSave('::dialog-save')).toMatchObject({ done: true })
    // A selector reaching outside the dialog does not resolve inside it.
    expect(findDialogSave('#next_path')).toMatchObject({ done: false, reason: 'selector_missing' })
  })

  it('a dialog field with no dialog open fails as missing', async () => {
    const r = await run(await cmd({ dialog: true, selector: '#countryOfResidence_select', mappedValue: '209' }))
    expect(r).toMatchObject({ outcome: 'failed', reason: 'selector_missing' })
  })

  it('the probe reports an add button present under its op, and the Save button never', async () => {
    const res = await deliver(mock.listeners.onMessage, {
      type: 'readback',
      selectors: ['#otherCountriesResidences_add_button', '::dialog-save', '#otherCountriesResidences_add_button'],
      ops: ['dialog_open', 'dialog_save', null],
    })
    expect(res).toEqual([
      expect.objectContaining({ found: true }),
      expect.objectContaining({ found: false }),
      // Without its op, a button is not a data field.
      expect.objectContaining({ found: false }),
    ])
  })
})

describe('value writes', () => {
  it('fire input, change and blur (IRCC validates on blur)', () => {
    document.body.innerHTML = '<input id="cityBirth_input" type="text" />'
    const el = document.getElementById('cityBirth_input')!
    const fired: string[] = []
    for (const e of ['input', 'change', 'blur']) el.addEventListener(e, () => fired.push(e))
    expect(executeWrite('#cityBirth_input', 'Rawalpindi')).toMatchObject({ written: true })
    expect(fired).toEqual(['input', 'change', 'blur'])
  })
})

describe('the probe says which page is open (path only)', () => {
  it('background reports the bound tab URL path, never its query', async () => {
    const m = installChromeMock()
    m.chrome.tabs.sendMessage.mockImplementation(async () => [{ selector: '#a', found: true, value: 'secret' }])
    m.chrome.tabs.get.mockImplementation(async (id: number) => ({
      id,
      url: 'https://tr-rt.apps.cic.gc.ca/nationality?appPkgId=123&appId=456&lang=en',
    }))
    jest.isolateModules(() => {
      require('../src/background')
    })
    await deliver(m.listeners.onMessage, { type: 'pf-bind-session', executionId: 'e', tabId: 7 })
    const res = await deliver(m.listeners.onMessage, { type: 'pf-probe', selectors: ['#a'], ops: [null] })
    expect(res).toEqual({ results: [{ selector: '#a', found: true }], page: '/nationality' })
    expect(m.chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { type: 'readback', selectors: ['#a'], ops: [null] })
  })
})
