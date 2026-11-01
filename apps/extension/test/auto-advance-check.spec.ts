/**
 * @jest-environment-options {"url": "https://tr-rt.apps.cic.gc.ca/activities?lang=en"}
 */
/// <reference types="chrome" />
declare function require(id: string): unknown
import { deliver, installChromeMock, type ChromeMock } from './chrome-mock'
import { advanceCheck, emptyRequired, irccErrors, pageStillClean } from '../src/executor/advance-check'

/**
 * The read-only check auto-advance runs before pressing "Save and continue",
 * and the content script's advance-press, which re-checks and presses once.
 */
function page(body = ''): void {
  document.body.innerHTML = `
    <main>
      <table id="t"><tr><td>Work 1</td></tr></table>
      ${body}
      <button id="next_path" type="button">Save and continue</button>
    </main>
    <div class="cdk-overlay-container"></div>`
}

describe('irccErrors / emptyRequired', () => {
  it('reads visible IRCC error texts and invalid fields, not hidden ones', () => {
    page(`<mat-error>This field is required.</mat-error>
          <div role="alert" style="display:none">old</div>
          <label for="x">City</label><input id="x" aria-invalid="true" />`)
    expect(irccErrors()).toEqual(['This field is required.', 'Not accepted: City'])
    page()
    expect(irccErrors()).toEqual([])
  })

  it('reads the live IRCC error markup (2026-10-31): .error, *error-message, "Error:" text', () => {
    page(`<div class="error">Error: Give details of all your employment for the past 10 years.</div>
          <span class="field-error-message">Countries or territories of residence - a row is required</span>
          <p><strong>Error:</strong>
             Countries or territories of residence - Enter your current country.</p>`)
    expect(irccErrors()).toEqual([
      'Error: Give details of all your employment for the past 10 years.',
      'Countries or territories of residence - a row is required',
      'Error: Countries or territories of residence - Enter your current country.',
    ])
  })

  it('ignores hidden, templated, screen-reader-only and empty error containers', () => {
    page(`<div class="error" style="display:none">Error: hidden</div>
          <div class="error"></div>
          <div role="alert"></div>
          <div role="alert" hidden>Error: gone</div>
          <template><p>Error: in a template</p></template>
          <span class="wb-inv">Error: screen reader only</span>
          <p>No error here: all good</p>`)
    expect(irccErrors()).toEqual([])
  })

  it('an empty required mat-select (no native select) is a required question left empty', () => {
    page(`<label id="occ_label">Occupation</label>
          <mat-select id="occ" aria-required="true" aria-labelledby="occ_label" class="mat-mdc-select mat-mdc-select-empty"><span class="mat-mdc-select-placeholder">Select</span></mat-select>
          <label id="ctry_label">Country</label>
          <mat-select id="ctry" aria-required="true" aria-labelledby="ctry_label" class="mat-mdc-select"><span class="mat-mdc-select-value-text"><span>Canada</span></span></mat-select>
          <mat-select id="opt" class="mat-mdc-select mat-mdc-select-empty"></mat-select>`)
    expect(emptyRequired()).toEqual(['Occupation'])
  })

  it('names required questions left empty (text, select, radio group)', () => {
    page(`<label for="a">Family name</label><input id="a" required />
          <label for="b">Country</label><select id="b" aria-required="true"><option value=""></option><option value="1">X</option></select>
          <fieldset><legend>Ever refused?</legend><input type="radio" name="r" value="y" required /><input type="radio" name="r" value="n" /></fieldset>
          <label for="c">Filled</label><input id="c" required value="ok" />
          <input id="d" required disabled />`)
    expect(emptyRequired()).toEqual(['Family name', 'Country', 'Ever refused?'])
  })
})

describe('advanceCheck waits for rows to hold still', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('not settled while rows keep being added; settled 3 s after the last one', async () => {
    page()
    const p = advanceCheck(3000, 20_000)
    let done = false
    void p.then(() => (done = true))
    for (let i = 0; i < 4; i++) {
      await jest.advanceTimersByTimeAsync(1000)
      document.getElementById('t')!.insertAdjacentHTML('beforeend', `<tr><td>Work ${i + 2}</td></tr>`)
    }
    expect(done).toBe(false)
    await jest.advanceTimersByTimeAsync(2500)
    expect(done).toBe(false)
    await jest.advanceTimersByTimeAsync(1000)
    const r = await p
    expect(r).toMatchObject({ settled: true, rows: 5, errors: [], required: [], sessionWarning: false })
  })

  it('never settles while a dialog is open', async () => {
    page()
    document.querySelector('.cdk-overlay-container')!.innerHTML = '<mat-dialog-container role="dialog"></mat-dialog-container>'
    const p = advanceCheck(3000, 8000)
    await jest.advanceTimersByTimeAsync(9000)
    expect(await p).toMatchObject({ settled: false, dialogOpen: true })
  })

  it('pageStillClean: a row added since the check is refused', () => {
    page()
    expect(pageStillClean(1)).toBeNull()
    document.getElementById('t')!.insertAdjacentHTML('beforeend', '<tr><td>late</td></tr>')
    expect(pageStillClean(1)).toMatch(/rows/)
  })
})

describe('content advance-press', () => {
  let mock: ChromeMock
  function loadContent() {
    mock = installChromeMock()
    jest.isolateModules(() => {
      require('../src/content')
    })
  }
  const press = (path: string, rows: number) =>
    deliver(mock.listeners.onMessage, { type: 'advance-press', path, rows }) as Promise<{ pressed: boolean; reason?: string }>

  it('presses #next_path once on the checked page; never for a page that changed or a dirty page', async () => {
    page()
    let clicks = 0
    document.getElementById('next_path')!.addEventListener('click', () => (clicks += 1))
    loadContent()
    expect(await press('/bio-data', 1)).toMatchObject({ pressed: false })
    expect(await press('/activities', 2)).toMatchObject({ pressed: false, reason: expect.stringMatching(/rows/) })
    document.querySelector('main')!.insertAdjacentHTML('afterbegin', '<mat-error>Required</mat-error>')
    expect(await press('/activities', 1)).toMatchObject({ pressed: false })
    document.querySelector('mat-error')!.remove()
    expect(clicks).toBe(0)
    expect(await press('/activities', 1)).toEqual({ pressed: true })
    expect(clicks).toBe(1)
    expect(await press('/activities', 1)).toMatchObject({ pressed: false })
    expect(clicks).toBe(1)
  })

  it('a message from another extension is ignored', async () => {
    page()
    loadContent()
    const r = await deliver(mock.listeners.onMessage, { type: 'advance-press', path: '/activities', rows: 1 }, { id: 'other' }, 200)
    expect(r).toBe('NO_RESPONSE')
  })
})
