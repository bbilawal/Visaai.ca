import { pageRowTotal, questionText, topDialog, waitUntil } from './resolve-target'
import { sessionWarningShown } from '../session-warning'

/**
 * READ-ONLY. Whether the IRCC page may be saved by auto-advance: no IRCC
 * error or validation message showing, no required question left empty, no
 * dialog open, nothing loading, and the page's grid rows unchanged for a
 * while (a live run saved a grid page while rows were still being added).
 * Never writes, clicks or navigates.
 */

/** Grid rows (and dialogs, spinners) must hold still this long before a press. */
export const ROWS_STABLE_MS = 3000
/** How long the page gets to settle before auto-advance gives up. */
export const SETTLE_MAX_MS = 20_000

export interface AdvanceCheck {
  /** Rows, dialogs and loading indicators held still for ROWS_STABLE_MS. */
  settled: boolean
  dialogOpen: boolean
  busy: boolean
  rows: number
  /** IRCC error / validation texts showing. */
  errors: string[]
  /** Required questions showing with no answer (their label text). */
  required: string[]
  sessionWarning: boolean
}

function shown(el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if ((n as HTMLElement).hidden) return false
    const cs = getComputedStyle(n)
    if (cs.display === 'none') return false
  }
  const v = getComputedStyle(el).visibility
  return v !== 'hidden' && v !== 'collapse'
}

const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

// IRCC (Angular Material + WET) error texts: field errors, the page's error
// summary, alert boxes — and the tr-rt markup seen live 2026-10-31: `.error`
// and `*error-message` elements. Broad on purpose: a false alarm only stops
// auto-advance. An empty or hidden one (a persistent [role=alert] host) is
// not an error.
const ERROR_SELECTOR = [
  'mat-error',
  '.error',
  '[class*="error-message"]',
  '.mat-error',
  '.mat-mdc-form-field-error',
  '[role="alert"]',
  '.alert-danger',
  '.alert-error',
  '.error-summary',
  '.label-danger',
  '.invalid-feedback',
  '.help-block.error',
].join(', ')

// Not on the screen for a sighted applicant: WET's screen-reader-only text,
// aria-hidden parts. (A <template>'s content is not in the document at all.)
const UNSEEN = '.wb-inv, [aria-hidden="true"], script, style, noscript, template'

/** Visible text, as squashed words. */
function textOf(el: Element): string {
  return squash((el as HTMLElement).innerText ?? el.textContent)
}

const ERROR_PREFIX = /^\s*error\s*:/i

/** Shown on the screen and not screen-reader-only. */
const seen = (el: Element) => shown(el) && !el.closest(UNSEEN)

/** IRCC error / validation messages on the page (visible, non-empty text). */
export function irccErrors(root: ParentNode = document): string[] {
  const out: string[] = []
  const add = (t: string) => {
    if (t && !out.some((o) => o === t || o.includes(t) || t.includes(o))) out.push(t)
  }
  for (const el of Array.from(root.querySelectorAll(ERROR_SELECTOR))) {
    if (!seen(el)) continue
    add(textOf(el))
  }
  // tr-rt page text that starts "Error:" ("Error: Give details of all your
  // employment…", "Error:\nCountries or territories of residence - …", live
  // 2026-10-31), whatever element holds it: the outermost element whose
  // text starts so, inside the page's main content.
  const scope = (root as Document).querySelector?.('main') ?? (root instanceof Element ? root : null) ?? document.body
  if (scope) {
    // textContent for the test (innerText lays the page out on every call).
    const starts = (el: Element) => ERROR_PREFIX.test(el.textContent ?? '')
    for (const el of Array.from(scope.querySelectorAll('*'))) {
      if (!starts(el)) continue
      const parent = el.parentElement
      if (parent && parent !== scope && scope.contains(parent) && starts(parent)) continue
      if (!seen(el)) continue
      add(textOf(el).slice(0, 300))
    }
  }
  for (const el of Array.from(root.querySelectorAll('[aria-invalid="true"]'))) {
    if (!shown(el)) continue
    const t = `Not accepted: ${squash(questionText(el)) || el.id || 'a field'}`
    if (!out.includes(t)) out.push(t)
  }
  return out
}

/** Required questions on the screen with no answer: their label text. */
export function emptyRequired(root: ParentNode = document): string[] {
  const out: string[] = []
  const label = (el: Element) => squash(questionText(el)).split('\n')[0] || el.id || 'a required question'
  const radiosDone = new Set<string>()
  for (const el of Array.from(root.querySelectorAll('input, select, textarea'))) {
    const c = el as HTMLInputElement
    const required = c.required || c.getAttribute('aria-required') === 'true'
    if (!required || c.disabled || !shown(el)) continue
    const type = (c.type || '').toLowerCase()
    if (type === 'hidden' || type === 'button' || type === 'submit' || type === 'file') continue
    if (type === 'radio') {
      const name = c.name
      if (!name || radiosDone.has(name)) continue
      radiosDone.add(name)
      const group = Array.from(root.querySelectorAll(`input[type="radio"]`)).filter(
        (r) => (r as HTMLInputElement).name === name,
      ) as HTMLInputElement[]
      if (!group.some((r) => r.checked)) out.push(label(el))
      continue
    }
    if (type === 'checkbox') continue
    if (squash(c.value) === '') out.push(label(el))
  }
  // A Material select has no native <select>: empty when Material says so
  // (`*-select-empty`) or no value text shows.
  for (const m of Array.from(root.querySelectorAll('mat-select, [role="combobox"].mat-mdc-select, [role="combobox"].mat-select'))) {
    const required =
      m.getAttribute('aria-required') === 'true' || m.hasAttribute('required') || /\bmat(-mdc)?-select-required\b/.test(m.className)
    if (!required || m.getAttribute('aria-disabled') === 'true' || !shown(m)) continue
    const valueText = m.querySelector('.mat-select-value-text, .mat-mdc-select-value-text')
    const empty = /\bmat(-mdc)?-select-empty\b/.test(m.className) || !valueText || squash(valueText.textContent) === ''
    if (!empty) continue
    const t = squash(questionText(m)).split('\n')[0] || m.id || 'a required question'
    if (!out.includes(t)) out.push(t)
  }
  // Material radio groups mark the group, not the inputs.
  for (const g of Array.from(root.querySelectorAll('[role="radiogroup"][aria-required="true"], mat-radio-group[required]'))) {
    if (!shown(g)) continue
    const inputs = Array.from(g.querySelectorAll('input[type="radio"]')) as HTMLInputElement[]
    if (inputs.length && !inputs.some((r) => r.checked)) {
      const t = squash(g.getAttribute('aria-label')) || label(inputs[0])
      if (!out.includes(t)) out.push(t)
    }
  }
  return out
}

/** Something is loading: a spinner, a progress bar, an overlay backdrop. */
export function pageBusy(root: ParentNode = document): boolean {
  return Array.from(
    root.querySelectorAll('mat-spinner, mat-progress-spinner, mat-progress-bar, .cdk-overlay-backdrop, [aria-busy="true"]'),
  ).some(shown)
}

/** One look: grid rows, dialog, loading. */
function snapshot(): { key: string; dialogOpen: boolean; busy: boolean; rows: number } {
  const dialogOpen = topDialog() !== null
  const busy = pageBusy()
  const rows = pageRowTotal()
  return { key: `${dialogOpen}|${busy}|${rows}`, dialogOpen, busy, rows }
}

/**
 * Wait until no dialog is open, nothing loads and the row count has not
 * changed for `stableMs`; then report the page. `settled` is false when that
 * never happened within `maxMs`.
 */
export async function advanceCheck(stableMs = ROWS_STABLE_MS, maxMs = SETTLE_MAX_MS): Promise<AdvanceCheck> {
  let last = snapshot()
  let since = Date.now()
  const settled = await waitUntil(
    () => {
      const now = snapshot()
      if (now.key !== last.key) {
        last = now
        since = Date.now()
        return false
      }
      return !now.dialogOpen && !now.busy && Date.now() - since >= stableMs
    },
    maxMs,
    250,
  )
  return {
    settled,
    dialogOpen: last.dialogOpen,
    busy: last.busy,
    rows: last.rows,
    errors: irccErrors(),
    required: emptyRequired(),
    sessionWarning: sessionWarningShown(document),
  }
}

/** The same verdict without waiting (right before the press): the page must still be clean. */
export function pageStillClean(rows: number): string | null {
  const now = snapshot()
  if (now.dialogOpen) return 'a dialog is open'
  if (now.busy) return 'the page is still loading'
  if (now.rows !== rows) return 'rows were still being added'
  if (irccErrors().length) return 'IRCC shows a message'
  if (emptyRequired().length) return 'a required question is empty'
  if (sessionWarningShown(document)) return 'IRCC is about to sign you out'
  return null
}
