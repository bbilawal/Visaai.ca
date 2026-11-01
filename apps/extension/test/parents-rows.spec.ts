/// <reference types="chrome" />
declare function require(id: string): unknown
import { deliver, installChromeMock, type ChromeMock } from './chrome-mock'
import { hashValue, normalizeValue } from '../src/readback-engine'
import { PORTAL_FILL_PROTOCOL_VERSION, type PortalFillWriteCommand } from '../src/shared'

/**
 * Live 2026-10-19, /family-info-parents: parent 1 (father) was added, then the
 * run stopped and parent 2 (mother) was never added. IRCC's empty grid shows a
 * "no records" placeholder row; the first saved row REPLACES it, so the table
 * never gained a row and parent 1's Save was reported refused. Right after a
 * Save IRCC also re-renders the grid, its add button briefly disabled.
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
const run = (command: PortalFillWriteCommand, ms = 8000) =>
  deliver(mock.listeners.onMessage, { type: 'execute-field-intent', command }, undefined, ms) as Promise<{
    outcome: string
    reason?: string
  }>

const DIALOG = `
  <mat-dialog-container role="dialog">
    <input id="lastName_input" type="text" />
    <input id="firstName_input" type="text" />
    <select id="relationshipParents_select"><option value=""></option><option value="F">Father</option><option value="M">Mother</option></select>
    <input id="parentOccupation_input" type="text" />
    <input id="parentComingCanada_radio-button-02-input" type="radio" name="coming" />
    <button id="name_save_button" type="button">Save</button>
    <button type="button">Cancel</button>
  </mat-dialog-container>`

function page() {
  document.body.innerHTML = `
    <main>
      <input id="lastName_input" type="text" />
      <table id="grid">
        <tr><th>Family name</th><th>Given name</th><th>Relationship</th><th>Date of birth</th></tr>
        <tr class="empty"><td colspan="4">No records to display</td></tr>
      </table>
      <button id="parentInfoGrid_add_button" type="button">Add</button>
    </main>
    <div class="cdk-overlay-container"></div>`
  const add = document.getElementById('parentInfoGrid_add_button') as HTMLButtonElement
  add.addEventListener('click', () => {
    const overlay = document.querySelector('.cdk-overlay-container')!
    overlay.innerHTML = DIALOG
    document.getElementById('name_save_button')!.addEventListener('click', () => {
      const v = (id: string) => (overlay.querySelector(`#${id}`) as HTMLInputElement).value
      const rel = (overlay.querySelector('#relationshipParents_select') as HTMLSelectElement).selectedOptions[0]?.text
      const cells = `<td>${v('lastName_input')}</td><td>${v('firstName_input')}</td><td>${rel}</td><td>1960-01-01</td>`
      overlay.innerHTML = ''
      document.querySelector('#grid tr.empty')?.remove()
      const tr = document.createElement('tr')
      tr.innerHTML = cells
      document.getElementById('grid')!.appendChild(tr)
      // The grid re-renders: add is disabled for a moment.
      add.disabled = true
      setTimeout(() => (add.disabled = false), 300)
    })
  })
}

async function addParent(given: string, family: string, rel: 'Father' | 'Mother') {
  const summary = `${given} ${family} (${rel}, born 1960-01-01)`
  const steps: PortalFillWriteCommand[] = [
    await cmd({ op: 'dialog_open', selector: '#parentInfoGrid_add_button', mappedValue: summary }),
    await cmd({ dialog: true, selector: '#lastName_input', mappedValue: family }),
    await cmd({ dialog: true, selector: '#firstName_input', mappedValue: given }),
    await cmd({ dialog: true, op: 'select_text', selector: '#relationshipParents_select', mappedValue: rel }),
    await cmd({ dialog: true, selector: '#parentOccupation_input', mappedValue: 'Retired' }),
    await cmd({ dialog: true, op: 'radio', selector: '#parentComingCanada_radio-button-02-input', mappedValue: 'No' }),
    await cmd({ dialog: true, op: 'dialog_save', selector: '#name_save_button', mappedValue: summary }),
  ]
  for (const s of steps) { const r = await run(s); expect([s.op ?? s.selector, r.outcome, r.reason]).toEqual([s.op ?? s.selector, "verified", undefined]) }
}

describe('/family-info-parents: both parents are added, one dialog after the other', () => {
  beforeEach(() => {
    page()
    mock = installChromeMock()
    jest.isolateModules(() => {
      require('../src/content')
    })
  })

  it('the first row replacing the "no records" row counts as saved, and parent 2 follows', async () => {
    await addParent('Muhammad', 'Khan', 'Father')
    await addParent('Fatima', 'Bibi', 'Mother')
    const rows = Array.from(document.querySelectorAll('#grid tr')).map((r) => r.textContent)
    expect(rows).toHaveLength(3)
    expect(rows[1]).toContain('Father')
    expect(rows[2]).toContain('Mother')
    expect((document.querySelector('main #lastName_input') as HTMLInputElement).value).toBe('')
  }, 20000)

  it('a Save that closes nothing is still refused', async () => {
    await run(await cmd({ op: 'dialog_open', selector: '#parentInfoGrid_add_button', mappedValue: 'A B (Father, born 1960-01-01)' }))
    document.getElementById('name_save_button')!.replaceWith(
      Object.assign(document.createElement('button'), { id: 'name_save_button', type: 'button', textContent: 'Save' }),
    )
    const r = await run(
      await cmd({ dialog: true, op: 'dialog_save', selector: '#name_save_button', mappedValue: 'A B (Father, born 1960-01-01)' }),
      9000,
    )
    expect(r).toMatchObject({ outcome: 'failed', reason: 'controlled_rejected' })
  }, 12000)
})
