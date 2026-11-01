/**
 * @jest-environment-options {"url": "https://tr-rt.apps.cic.gc.ca/bio-data?lang=en"}
 */
declare function require(id: string): unknown
import { AUTO_ADVANCE_PAGES, isAutoAdvancePath, isAutoAdvanceUrl, isTrrtSummaryUrl } from '../src/trrt-pages'
import {
  isSafeAddButton,
  isSafeDialogSave,
  isSafePagerButton,
  isSafeSaveAndContinue,
} from '../src/executor/safety-guards'

/**
 * Auto-advance (owner decision 2026-10-31) may press ONE page-leaving button:
 * the IRCC Portal's "Save and continue" #next_path, on an allow-listed tr-rt
 * form page, once per page. Everything else stays forbidden.
 */
type Actuator = typeof import('../src/executor/control-actuator')
const actuator = (): Actuator => {
  let m: Actuator | undefined
  jest.isolateModules(() => {
    m = require('../src/executor/control-actuator') as Actuator
  })
  return m!
}

const go = (path: string) => window.history.pushState({}, '', path)

function page(extra = ''): { clicks: string[] } {
  document.body.innerHTML = `
    <main>
      <input id="lastName_input" type="text" value="Doe" />
      <button id="previous_path" type="button">Back</button>
      <button id="next_path" type="button">Save and continue</button>
      <button id="submit_btn" type="button">Submit</button>
      <button id="sign_btn" type="button">Sign</button>
      <button id="pay_btn" type="button">Pay now</button>
      <button id="continue_other" type="button">Save and continue</button>
      ${extra}
    </main>
    <div class="cdk-overlay-container"></div>`
  const clicks: string[] = []
  for (const b of Array.from(document.querySelectorAll('button'))) b.addEventListener('click', () => clicks.push(b.id))
  return { clicks }
}
const el = (id: string) => document.getElementById(id)!

beforeEach(() => go('/bio-data?lang=en'))

describe('allow-list', () => {
  it('lists the visitor form pages, never doc-upload, summary or anything after', () => {
    expect(AUTO_ADVANCE_PAGES).toContain('/bio-data')
    expect(AUTO_ADVANCE_PAGES).toContain('/contact-info-tel')
    for (const p of ['/doc-upload', '/summary', '/fees', '/consent', '/declaration', '/e-sign', '/pay', '/payment', '/submit', '/error', '/', '/landing-page'])
      expect(isAutoAdvancePath(p)).toBe(false)
  })
  it('needs the tr-rt host over https', () => {
    expect(isAutoAdvanceUrl('https://tr-rt.apps.cic.gc.ca/bio-data?x=1')).toBe(true)
    expect(isAutoAdvanceUrl('http://tr-rt.apps.cic.gc.ca/bio-data')).toBe(false)
    expect(isAutoAdvanceUrl('https://tr-rt.apps.cic.gc.ca.evil.test/bio-data')).toBe(false)
    expect(isAutoAdvanceUrl('https://prson-srpel.apps.cic.gc.ca/bio-data')).toBe(false)
    expect(isAutoAdvanceUrl('https://eta.onlineservices-servicesenligne.apps.cic.gc.ca/bio-data')).toBe(false)
    expect(isTrrtSummaryUrl('https://tr-rt.apps.cic.gc.ca/summary?lang=en')).toBe(true)
  })
})

describe('isSafeSaveAndContinue', () => {
  it('accepts #next_path "Save and continue" on an allow-listed tr-rt page', () => {
    page()
    expect(isSafeSaveAndContinue(el('next_path'))).toBe(true)
  })

  it('accepts the live markup: text span plus an arrow_forward <mat-icon> (2026-10-31)', () => {
    page()
    el('next_path').innerHTML =
      '<span class="mat-button-wrapper"><span>Save and continue</span> <mat-icon class="mat-icon notranslate material-icons">arrow_forward</mat-icon></span><span class="mat-ripple"></span>'
    expect(isSafeSaveAndContinue(el('next_path'))).toBe(true)
    // Only icon text is dropped: other words beside the label still refuse.
    el('next_path').innerHTML = '<span>Save and continue</span> <span>and submit</span><mat-icon>arrow_forward</mat-icon>'
    expect(isSafeSaveAndContinue(el('next_path'))).toBe(false)
    el('next_path').innerHTML = '<span>Submit</span><mat-icon>Save and continue</mat-icon>'
    expect(isSafeSaveAndContinue(el('next_path'))).toBe(false)
  })

  it('refuses every other button, including one with the same text', () => {
    page()
    for (const id of ['previous_path', 'submit_btn', 'sign_btn', 'pay_btn', 'continue_other'])
      expect(isSafeSaveAndContinue(el(id))).toBe(false)
    expect(isSafeSaveAndContinue(el('lastName_input'))).toBe(false)
  })

  it('refuses #next_path on summary, documents, fees, error and unknown pages', () => {
    page()
    for (const p of ['/summary', '/doc-upload', '/fees', '/consent', '/error', '/landing-page', '/', '/something-new']) {
      go(p)
      expect(isSafeSaveAndContinue(el('next_path'))).toBe(false)
    }
  })

  it('refuses #next_path with other text, disabled, hidden, or inside a dialog', () => {
    page()
    el('next_path').textContent = 'Submit application'
    expect(isSafeSaveAndContinue(el('next_path'))).toBe(false)
    el('next_path').textContent = 'Save and continue'
    ;(el('next_path') as HTMLButtonElement).disabled = true
    expect(isSafeSaveAndContinue(el('next_path'))).toBe(false)
    ;(el('next_path') as HTMLButtonElement).disabled = false
    el('next_path').style.display = 'none'
    expect(isSafeSaveAndContinue(el('next_path'))).toBe(false)
    document.body.innerHTML = `<mat-dialog-container role="dialog"><button id="next_path" type="button">Save and continue</button></mat-dialog-container>`
    expect(isSafeSaveAndContinue(el('next_path'))).toBe(false)
  })

  it('every OTHER guard still refuses #next_path', () => {
    page(`<mat-paginator id="pg"></mat-paginator>`)
    expect(isSafeAddButton(el('next_path'), false)).toBe(false)
    expect(isSafeDialogSave(el('next_path'), document.body)).toBe(false)
    expect(isSafePagerButton(el('next_path'), document.body)).toBe(false)
  })
})

describe('pressSaveAndContinue', () => {
  it('clicks only #next_path, once per page', () => {
    const { clicks } = page()
    const a = actuator()
    expect(a.pressSaveAndContinue()).toMatchObject({ done: true })
    expect(clicks).toEqual(['next_path'])
    // IRCC kept the page (validation error): never a second press here.
    expect(a.pressSaveAndContinue()).toMatchObject({ done: false, reason: 'unsafe_target' })
    expect(clicks).toEqual(['next_path'])
    // The next page gets its one press.
    go('/bio-data-travel-docs')
    expect(a.pressSaveAndContinue()).toMatchObject({ done: true })
    expect(clicks).toEqual(['next_path', 'next_path'])
  })

  it('never presses on Summary or with a dialog open, or with two #next_path', () => {
    const { clicks } = page()
    const a = actuator()
    go('/summary')
    expect(a.pressSaveAndContinue()).toMatchObject({ done: false })
    go('/bio-data')
    document.querySelector('.cdk-overlay-container')!.innerHTML =
      '<mat-dialog-container role="dialog"><button type="button">Save</button></mat-dialog-container>'
    expect(a.pressSaveAndContinue()).toMatchObject({ done: false })
    document.querySelector('.cdk-overlay-container')!.innerHTML = ''
    document.querySelector('main')!.insertAdjacentHTML('beforeend', '<button id="next_path" type="button">Save and continue</button>')
    expect(a.pressSaveAndContinue()).toMatchObject({ done: false, reason: 'unsafe_target' })
    expect(clicks).toEqual([])
  })
})
