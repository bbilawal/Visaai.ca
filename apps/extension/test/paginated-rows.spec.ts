/// <reference types="chrome" />
declare function require(id: string): unknown
import { deliver, installChromeMock, type ChromeMock } from './chrome-mock'
import { hashValue, normalizeValue } from '../src/readback-engine'
import { PORTAL_FILL_PROTOCOL_VERSION, type PortalFillWriteCommand } from '../src/shared'

/**
 * Live 2026-10-19, /travel-history: IRCC's grid shows 3 rows a page. Trip 4
 * was saved onto page 2, the rows on screen did not change, its Save was
 * reported refused and the run stopped at 3 of 8 trips. Filling the page
 * again did not see trip 1 (sorted onto page 2) and added it a second time.
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

const PER_PAGE = 3
let trips: string[][] = []
let pageIndex = 0
/** 'legacy': mat-paginator classes, first-page button, real disabled.
 *  'mdc': MDC classes, no first-page button, aria-disabled only. */
let flavour: 'legacy' | 'mdc' = 'legacy'
let newestFirst = false

/** IRCC's grid: 3 a page with a Material paginator; in the order added during a fill. */
function render() {
  const sorted = newestFirst ? [...trips].sort((a, b) => (a[0] < b[0] ? 1 : -1)) : [...trips]
  const pages = Math.max(1, Math.ceil(sorted.length / PER_PAGE))
  pageIndex = Math.min(pageIndex, pages - 1)
  const shown = sorted.slice(pageIndex * PER_PAGE, pageIndex * PER_PAGE + PER_PAGE)
  // A row shows both months, as IRCC's does: a same-month trip carries its
  // month twice, and the row match counts it (0.1.42).
  document.getElementById('grid')!.innerHTML =
    '<tr><th>From</th><th>To</th><th>Country</th></tr>' +
    (shown.length
      ? shown.map((t) => `<tr><td>From ${t[0]}</td><td>To ${t[0]}</td><td>${t[1]}</td></tr>`).join('')
      : '<tr class="empty"><td colspan="3">No records to display</td></tr>')
  const from = sorted.length ? pageIndex * PER_PAGE + 1 : 0
  const to = Math.min(sorted.length, (pageIndex + 1) * PER_PAGE)
  const m = flavour === 'mdc' ? 'mat-mdc-paginator' : 'mat-paginator'
  const off = (b: boolean) => (!b ? '' : flavour === 'mdc' ? 'aria-disabled="true"' : 'disabled')
  document.getElementById('pager')!.innerHTML = `
    <div class="${m}-range-label">${from} to ${to} of ${sorted.length}</div>
    ${flavour === 'legacy' ? `<button type="button" class="${m}-navigation-first" aria-label="Go to first page" ${off(pageIndex === 0)}>|&lt;</button>` : ''}
    <button type="button" class="${m}-navigation-previous" aria-label="Go to previous page" ${off(pageIndex === 0)}>&lt;</button>
    <button type="button" class="${m}-navigation-next" aria-label="Go to next page" ${off(pageIndex >= pages - 1)}>&gt;</button>`
  const pager = document.getElementById('pager')!
  const on = (cls: string, f: () => void) =>
    pager.querySelector(`.${m}-navigation-${cls}`)?.addEventListener('click', (e) => {
      if ((e.currentTarget as HTMLElement).getAttribute('aria-disabled') === 'true') return
      f()
      render()
    })
  on('first', () => (pageIndex = 0))
  on('previous', () => (pageIndex = Math.max(0, pageIndex - 1)))
  on('next', () => (pageIndex += 1))
}

function page() {
  trips = []
  pageIndex = 0
  newestFirst = false
  document.body.innerHTML = `
    <main>
      <table id="grid"></table>
      <mat-paginator id="pager"></mat-paginator>
      <button id="travelHistoryTable_add_button" type="button">Add</button>
    </main>
    <div class="cdk-overlay-container"></div>`
  render()
  document.getElementById('travelHistoryTable_add_button')!.addEventListener('click', () => {
    const overlay = document.querySelector('.cdk-overlay-container')!
    overlay.innerHTML = `
      <mat-dialog-container role="dialog">
        <input id="from_input" type="text" />
        <input id="country_input" type="text" />
        <button id="travel_save_button" type="button">Save</button>
      </mat-dialog-container>`
    document.getElementById('travel_save_button')!.addEventListener('click', () => {
      const v = (id: string) => (overlay.querySelector(`#${id}`) as HTMLInputElement).value
      trips.push([v('from_input'), v('country_input')])
      overlay.innerHTML = ''
      render()
    })
  })
}

async function addTrip(from: string, country: string) {
  const summary = `${country} ${from} to ${from}`
  const steps: PortalFillWriteCommand[] = [
    await cmd({ op: 'dialog_open', selector: '#travelHistoryTable_add_button', mappedValue: summary }),
    await cmd({ dialog: true, selector: '#from_input', mappedValue: from }),
    await cmd({ dialog: true, selector: '#country_input', mappedValue: country }),
    await cmd({ dialog: true, op: 'dialog_save', selector: '#travel_save_button', mappedValue: summary }),
  ]
  for (const s of steps) {
    const r = await run(s)
    expect([s.op ?? s.selector, r.outcome, r.reason]).toEqual([s.op ?? s.selector, 'verified', undefined])
  }
}

const TRIPS: [string, string][] = [
  ['2022-05', 'Thailand'],
  ['2022-08', 'Turkey'],
  ['2022-09', 'Oman'],
  ['2023-05', 'Malaysia'],
  ['2023-06', 'Singapore'],
]

describe('/travel-history: a grid that shows 3 rows a page', () => {
  beforeEach(() => {
    flavour = 'legacy'
    page()
    mock = installChromeMock()
    jest.isolateModules(() => {
      require('../src/content')
    })
  })

  it('a row saved onto another page counts as saved, and every trip is added', async () => {
    for (const [from, country] of TRIPS) await addTrip(from, country)
    expect(trips).toHaveLength(5)
  }, 40000)

  it('filling the page again adds nothing: rows on page 2 are seen', async () => {
    for (const [from, country] of TRIPS) await addTrip(from, country)
    for (const [from, country] of TRIPS) await addTrip(from, country)
    expect(trips).toHaveLength(5)
    // Left on the first page.
    expect(document.querySelector('.mat-paginator-range-label')!.textContent).toBe('1 to 3 of 5')
  }, 60000)

  it('newer Material: no first-page button, aria-disabled; re-entry sorted newest first adds nothing', async () => {
    flavour = 'mdc'
    render()
    for (const [from, country] of TRIPS) await addTrip(from, country)
    expect(trips).toHaveLength(5)
    // IRCC re-sorted the grid newest first when the page was opened again,
    // and it was left on its last page.
    newestFirst = true
    pageIndex = 1
    render()
    for (const [from, country] of TRIPS) await addTrip(from, country)
    expect(trips).toHaveLength(5)
    expect(document.querySelector('.mat-mdc-paginator-range-label')!.textContent).toBe('1 to 3 of 5')
  }, 60000)
})

describe('/travel-history: an unsafe page button is never clicked', () => {
  beforeEach(() => {
    flavour = 'legacy'
    page()
    mock = installChromeMock()
    jest.isolateModules(() => {
      require('../src/content')
    })
  })

  it('a typeless (submitting) next button fails the step instead of reading a partial list', async () => {
    for (const [from, country] of TRIPS) await addTrip(from, country)
    const next = document.querySelector('.mat-paginator-navigation-next') as HTMLButtonElement
    next.removeAttribute('type')
    let clicked = 0
    next.addEventListener('click', () => clicked++)
    const r = await run(
      await cmd({ op: 'dialog_open', selector: '#travelHistoryTable_add_button', mappedValue: 'Malaysia 2023-05 to 2023-05' }),
    )
    expect(r).toMatchObject({ outcome: 'failed', reason: 'unsafe_target' })
    expect(clicked).toBe(0)
    expect(trips).toHaveLength(5)
  }, 40000)
})
