/**
 * Resolve a server-supplied selector to the ONE element it names. READ-ONLY.
 *
 * Every DOM lookup in the content script goes through here, for two reasons:
 *
 *  - `querySelector` THROWS a SyntaxError on an invalid selector. Uncaught, it
 *    rejected the handler's promise, the message port closed with no answer,
 *    and the run stalled for the full bridge timeout instead of failing that
 *    one field at once. An invalid selector is reported, never thrown.
 *  - First-match is not identification. If a selector matches two fields, the
 *    write lands on the first, the readback re-queries the same first match,
 *    and a write to the wrong field verifies as correct. A selector that
 *    matches more than one element is `ambiguous` and nothing is written.
 *
 * `root` scopes the lookup: a field inside an "add row" dialog is resolved
 * inside that dialog only (IRCC reuses `#lastName_input` on the page behind it).
 */
export type TargetResolution =
  | { status: 'found'; el: Element }
  | { status: 'missing' | 'invalid' | 'ambiguous' }
  /** The one control is there, but its <select> does not list the scoped option. */
  | { status: 'no_option'; el: Element }

export function resolveTarget(selector: string, root: ParentNode = document): TargetResolution {
  if (typeof selector !== 'string' || selector === '') return { status: 'invalid' }
  const scoped = parseScopedSelector(selector)
  if (scoped === null) return { status: 'invalid' }
  let matches: Element[]
  // `>> dependant`: inside the PR profile's one open inline dependant form
  // only (its date of birth reuses the principal's id).
  let scope: ParentNode = root
  if (scoped.dependant) {
    const form = dependantForm()
    if (!form) return { status: 'missing' }
    if (root !== document && !(root as Node).contains(form)) return { status: 'missing' }
    // The dependant's date of birth shares the principal's id: with fewer
    // than two on the page, the one there is not known to be the dependant's.
    if (/#personalDetailsForm-dob\b/.test(scoped.css) && document.querySelectorAll('#personalDetailsForm-dob').length < 2)
      return { status: 'ambiguous' }
    scope = form
  }
  try {
    matches = Array.from(scope.querySelectorAll(scoped.css))
  } catch {
    return { status: 'invalid' }
  }
  if (scoped.page && !scoped.page.test(screenText())) return { status: 'missing' }
  if (scoped.principal && !principalFormHere()) return { status: 'missing' }
  if (scoped.label) {
    const re = scoped.label
    matches = matches.filter((el) => re.test(questionText(el)))
  }
  if (scoped.nth) {
    // The k-th match in document order, with at most `most` matches: fewer
    // than k is not there yet; more than `most` is not the recorded page.
    const { k, most } = scoped.nth
    if (matches.length > most) return { status: 'ambiguous' }
    matches = matches.length >= k ? [matches[k - 1]] : []
  }
  if (matches.length === 0) return { status: 'missing' }
  if (matches.length > 1) return { status: 'ambiguous' }
  if (scoped.option && !listsOption(matches[0], scoped.option)) return { status: 'no_option', el: matches[0] }
  return { status: 'found', el: matches[0] }
}

/**
 * Option text as compared, everywhere a select is chosen or read by text:
 * collapsed, case-folded, and a number without its leading zeros, so IRCC's
 * day "05" is the reviewed "5" (and the eTA's "01" stays "01" = "1").
 */
export function optionKey(text: string | null | undefined): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  return /^\d+$/.test(t) ? String(Number(t)) : t
}

/** Whether a <select> lists the option (by value, or by text as optionKey compares). */
function listsOption(el: Element, option: { by: 'value' | 'text'; value: string }): boolean {
  if (!(el instanceof HTMLSelectElement)) return false
  const opts = Array.from(el.options)
  const { by, value: wanted } = option
  // READ-ONLY comparison (written wanted-first: no assignment-shaped text).
  if (by === 'value') return opts.some((o) => wanted === o.value)
  const want = optionKey(wanted)
  return opts.filter((o) => optionKey(o.text) === want).length === 1
}

/**
 * QUESTION-SCOPED SELECTORS.
 *
 * IRCC's secure-account questionnaire ("eapp", the study permit) shows every
 * screen at the same URL (/eapp/eapp) and reuses the same ids on each:
 * `select#answerlist[0]` is "Are you an exchange student?" on one screen and
 * "What is your marital status?" on the next. An id alone would write one
 * question's answer into another. The server therefore names such a control
 * by its CSS AND its question:
 *
 *   <css> >> label=/<regex>/<flags>   the control's own label must match
 *   <css> >> page=/<regex>/<flags>    the screen must show matching text
 *   <css> >> principal                the open form must be the principal
 *                                     applicant's own (PR portal; see
 *                                     principalFormHere)
 *   <css> >> keep                     (write rule) a different value already
 *                                     in the box is not overwritten
 *   <css> >> rows=<n>                 (row_add rule) the page may hold at
 *                                     most n rows of this section
 *   <css> >> dependant                inside the PR profile's one open
 *                                     inline "Add dependant" form only
 *                                     (see dependantForm)
 *   <css> >> nth=<k>/<most>           a block that reuses another block's
 *                                     ids (PR portal profile: residential
 *                                     after mailing): the k-th match in
 *                                     document order, of at most <most>
 *   <css> >> option=value:<v>         its <select> must list this option
 *   <css> >> option=text:<t>          … or one option with this text
 *
 * (any of them, in that order; the API composes them in
 * portal-fill.registry.ts `scopedSelector`). A control whose question is not
 * on the screen resolves to `missing` — the write waits for its screen — and
 * the one-element rule still applies to what is left. A control that is there
 * but does not list the reviewed option is `no_option`: the probe reports it
 * so the server refuses the screen before anything on it is written. A selector without
 * ` >> ` is plain CSS, exactly as before. A scope that does not parse is
 * `invalid`, never "no scope".
 */
export const SCOPE_SEPARATOR = ' >> '
const SCOPE_PART = /^(label|page)=\/(.+)\/([a-z]*)$/s
const PRINCIPAL_PART = 'principal'
const KEEP_PART = 'keep'
const DEPENDANT_PART = 'dependant'
const ROWS_PART = /^rows=([1-9]\d?)$/
const NTH_PART = /^nth=([1-9])\/([1-9])$/
const OPTION_PART = /^option=(value|text):(.+)$/s

export interface ScopedSelector {
  css: string
  label?: RegExp
  page?: RegExp
  principal?: boolean
  /** Row fields: never overwrite a different value already in the box. */
  keep?: boolean
  /** Inside the PR profile's open inline dependant form only. */
  dependant?: boolean
  /** A section's row guard: the page may hold at most this many rows. */
  rows?: number
  /** The k-th of at most `most` matches (ids a later block reuses). */
  nth?: { k: number; most: number }
  option?: { by: 'value' | 'text'; value: string }
}

export function parseScopedSelector(selector: string): ScopedSelector | null {
  if (!selector.includes(SCOPE_SEPARATOR)) return { css: selector }
  const [css, ...parts] = selector.split(SCOPE_SEPARATOR)
  if (!css.trim() || parts.length === 0) return null
  const out: ScopedSelector = { css }
  for (const part of parts) {
    const o = OPTION_PART.exec(part)
    if (o) {
      if (out.option) return null
      out.option = { by: o[1] as 'value' | 'text', value: o[2] }
      continue
    }
    if (out.option) return null // the option comes last
    if (part === PRINCIPAL_PART) {
      if (out.principal) return null
      out.principal = true
      continue
    }
    if (part === KEEP_PART) {
      if (out.keep) return null
      out.keep = true
      continue
    }
    if (part === DEPENDANT_PART) {
      if (out.dependant) return null
      out.dependant = true
      continue
    }
    const n = NTH_PART.exec(part)
    if (n) {
      const k = Number(n[1])
      const most = Number(n[2])
      if (out.nth !== undefined || k > most) return null
      out.nth = { k, most }
      continue
    }
    const r = ROWS_PART.exec(part)
    if (r) {
      if (out.rows !== undefined) return null
      out.rows = Number(r[1])
      continue
    }
    const m = SCOPE_PART.exec(part)
    if (!m) return null
    const kind = m[1] as 'label' | 'page'
    if (out[kind]) return null
    // Stateless matching only: a g / y flag makes RegExp.test remember.
    if (/[gy]/.test(m[3])) return null
    try {
      out[kind] = new RegExp(m[2], m[3])
    } catch {
      return null
    }
  }
  return out
}

/** Text collapsed to single spaces, trimmed. */
const squash = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, ' ').trim()

/**
 * The question a control answers, as the page labels it: its label[for]
 * labels, a wrapping label, aria-label / aria-labelledby, and its fieldset's
 * legend. One line each. READ-ONLY.
 */
export function questionText(el: Element): string {
  const parts: string[] = []
  const id = el.getAttribute('id')
  if (id) {
    for (const l of Array.from(el.ownerDocument.querySelectorAll('label'))) {
      if ((l as HTMLLabelElement).htmlFor === id) parts.push(squash(l.textContent))
    }
  }
  const wrap = el.closest('label')
  if (wrap) parts.push(squash(wrap.textContent))
  const aria = el.getAttribute('aria-label')
  if (aria) parts.push(squash(aria))
  for (const ref of (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)) {
    parts.push(squash(el.ownerDocument.getElementById(ref)?.textContent))
  }
  const legend = el.closest('fieldset')?.querySelector('legend')
  if (legend) parts.push(squash(legend.textContent))
  return parts.filter(Boolean).join('\n')
}

// Option lists are answers, not the question; .wb-inv is WET's screen-reader
// only text (IRCC's "Required", hidden headings), not shown on the screen.
const NOT_SHOWN = 'script, style, noscript, template, option, optgroup, select, .wb-inv, [hidden], [aria-hidden="true"]'

/** Whether an element (or an ancestor) is plainly not on the screen. */
function hiddenByAncestor(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    if (e.matches(NOT_SHOWN)) return true
    const style = e.getAttribute('style') ?? ''
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(style)) return true
  }
  return false
}

/** The text the screen shows, collapsed (hidden and script text left out). READ-ONLY. */
export function screenText(doc: Document = document): string {
  const body = doc.body
  if (!body) return ''
  const out: string[] = []
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent ?? ''
    if (!t.trim()) continue
    if (hiddenByAncestor(n.parentElement)) continue
    out.push(t)
  }
  return squash(out.join(' '))
}

const DIALOG_SELECTOR = 'mat-dialog-container, [role="dialog"], [role="alertdialog"]'

/**
 * The open dialog on top (last in document order), or null. READ-ONLY.
 *
 * Only an OUTERMOST match counts: IRCC puts an info box marked
 * `role="dialog"` inside its row dialogs ("You must select 1 address where you
 * currently live"), and taking the last match picked that box, so every field
 * of the dialog read as missing (dry run 2026-10-16).
 */
export function topDialog(): Element | null {
  // Only a real modal counts. IRCC also marks its inline warning boxes
  // role="dialog" ("You must complete this entire section…" on Activities);
  // counting those meant a dialog was "always open", so an existing row was
  // added again and a successful row Save was reported as refused (dry run
  // 2026-10-16). A real one is a Material dialog or sits in the overlay layer.
  const all = Array.from(document.querySelectorAll(DIALOG_SELECTOR)).filter(
    (d) => d.tagName === 'MAT-DIALOG-CONTAINER' || !!d.closest('.cdk-overlay-container'),
  )
  const outer = all.filter((d) => !all.some((o) => o !== d && o.contains(d)))
  return outer.length ? outer[outer.length - 1] : null
}

/** Text of the data rows on the page behind any dialog. READ-ONLY. */
export function pageRowTexts(): string[] {
  return Array.from(document.querySelectorAll('tr, mat-row, [role="row"]'))
    .filter((r) => !inDialog(r))
    .map((r) => {
      // Cell by cell, so "Pakistan" | "Citizen" never read as one word.
      const cells = Array.from(r.querySelectorAll('td, th, mat-cell, [role="cell"]'))
      return cells.length
        ? cells.map((c) => c.textContent ?? '').join(' ')
        : ((r as HTMLElement).innerText ?? r.textContent ?? '')
    })
}

/** Whether an element sits inside a real dialog or the overlay layer. */
export function inDialog(el: Element): boolean {
  return !!el.closest('mat-dialog-container, .cdk-overlay-container')
}

/** Data rows on the page behind any dialog (table rows, Material rows). */
export function pageRowCount(): number {
  let n = 0
  for (const r of Array.from(document.querySelectorAll('tr, mat-row, [role="row"]'))) {
    if (!inDialog(r)) n += 1
  }
  return n
}

/**
 * Paginated grids. IRCC's travel-history grid shows 3 rows a page (live
 * 2026-10-19): trip 4 was saved onto page 2, the rows on screen did not
 * change, its Save was reported refused and the run stopped; filling the page
 * again did not see trip 1 (sorted onto page 2) and added it twice. A grid's
 * rows are read across all its pages, and its size from the paginator's
 * "1 to 3 of 5" label.
 */
// Read-only paginator helpers; page turns (clicks) live in control-actuator.ts.
export function gridPaginators(): Element[] {
  return Array.from(document.querySelectorAll('mat-paginator')).filter((p) => !inDialog(p))
}

const PAGE_NAV: Record<'first' | 'previous' | 'next', { cls: string; label: RegExp }> = {
  first: {
    cls: '.mat-paginator-navigation-first, .mat-mdc-paginator-navigation-first',
    label: /first page|premi[eè]re page/i,
  },
  previous: {
    cls: '.mat-paginator-navigation-previous, .mat-mdc-paginator-navigation-previous',
    label: /previous page|page pr[eé]c[eé]dente/i,
  },
  next: {
    cls: '.mat-paginator-navigation-next, .mat-mdc-paginator-navigation-next',
    label: /next page|page suivante/i,
  },
}

export function pageNav(p: Element, which: 'first' | 'previous' | 'next'): HTMLButtonElement | null {
  const { cls, label } = PAGE_NAV[which]
  return (
    (p.querySelector(cls) as HTMLButtonElement | null) ??
    (Array.from(p.querySelectorAll('button')).find((b) => label.test(b.getAttribute('aria-label') ?? '')) ?? null)
  )
}

/** Disabled, including Material's `disabledInteractive` (aria-disabled only). */
export const navOff = (b: HTMLButtonElement | null) => !b || b.disabled || b.getAttribute('aria-disabled') === 'true'

export const rangeLabel = (p: Element) =>
  p.querySelector('.mat-paginator-range-label, .mat-mdc-paginator-range-label')?.textContent ?? p.textContent ?? ''

/** The paginator's total ("1 to 3 of 5", "1 – 3 sur 5", "1 à 3 de 5" → 5), or null. */
function paginatorTotal(p: Element): number | null {
  const m = /\b(?:of|sur|de)\s+(\d+)/i.exec(rangeLabel(p))
  return m ? Number(m[1]) : null
}

/**
 * A size for the rows behind any dialog that also counts the rows on other
 * pages of a paginated grid: it grows whenever a row is added, wherever the
 * grid puts it. Only compared with itself. READ-ONLY.
 */
export function pageRowTotal(): number {
  let n = pageRowCount()
  for (const p of gridPaginators()) n += paginatorTotal(p) ?? 0
  return n
}

/**
 * Poll until the selector resolves, it turns ambiguous, or the time runs out.
 * IRCC renders follow-up questions after their parent radio is answered and a
 * dialog's fields after it opens, so these targets do not exist when the step
 * before them finishes. `scope` re-reads the root on every poll (a dialog).
 */
export async function waitForTarget(
  selector: string,
  scope: () => ParentNode | null = () => document,
  timeoutMs = 5000,
  intervalMs = 100,
  ready?: (el: Element) => boolean,
): Promise<TargetResolution> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const root = scope()
    const r = root ? resolveTarget(selector, root) : ({ status: 'missing' } as const)
    // `ready`: there is not enough — e.g. a revealed box IRCC enables only
    // after its radio is answered (PR portal phone country code). Keep
    // waiting, within the same deadline; at the deadline the target is
    // returned as it is and the step's own guard refuses it.
    const waiting = r.status === 'missing' || (r.status === 'found' && ready !== undefined && !ready(r.el))
    if (!waiting) return r
    if (Date.now() >= deadline) return r
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

/** Poll a condition; resolves true as soon as it holds, false at the deadline. */
export async function waitUntil(cond: () => boolean, timeoutMs = 5000, intervalMs = 100): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (cond()) return true
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

/**
 * WHOSE FORM. IRCC's Permanent Residence Portal gives every person on the
 * application their own IMM 5406 / IMM 5669 at the same path with the same
 * ids (live 2026-10-20). Only Section A says whose it is: a disabled radio,
 * "Yourself (the principal applicant)", checked (#principalAppYes on IMM 5406,
 * #principalApplicant on IMM 5669). The later sections show no marker, but
 * the URL's `documentId` is the person's form and stays the same across its
 * sections.
 *
 * So: on a screen that shows the marker, the form is the principal's exactly
 * when it is checked, and that answer is remembered for its documentId (this
 * tab's session storage, so a reload keeps it). On a screen without the
 * marker, only a remembered principal documentId passes. Anything else — a
 * dependant's form, a section opened before its Section A was seen, another
 * host — is not the principal's, and a `>> principal` write resolves to
 * nothing. READ-ONLY on the page; writes only its own storage key.
 */
const PR_HOST = 'prson-srpel.apps.cic.gc.ca'
/** Section A's radio pair on each form: the principal answer and its companion. */
const PRINCIPAL_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['principalAppYes', 'principalAppNo'], // IMM 5406
  ['principalApplicant', 'principalOther'], // IMM 5669
]
const PRINCIPAL_KEY = 'visaai.prPrincipalDocuments'
const remembered = new Set<string>()
let loaded = false

function storedDocuments(): Set<string> {
  if (!loaded) {
    loaded = true
    try {
      const raw = window.sessionStorage.getItem(PRINCIPAL_KEY)
      const list: unknown = raw ? JSON.parse(raw) : []
      if (Array.isArray(list)) for (const d of list) if (typeof d === 'string') remembered.add(d)
    } catch {
      // No storage (blocked, private mode): this tab's memory only.
    }
  }
  return remembered
}

function saveDocuments(): void {
  try {
    window.sessionStorage.setItem(PRINCIPAL_KEY, JSON.stringify([...remembered].slice(-50)))
  } catch {
    // Memory still holds it for this page.
  }
}

/**
 * Which person-form this is: the application (case) id and the form from
 * the path, and the documentId from the query —
 * "/en/application/case/<caseId>/imm5669?…&documentId=<id>" →
 * "<caseId>|imm5669|<id>". Null anywhere else.
 */
function formKeyHere(): string | null {
  try {
    const m = /^\/(?:en|fr)\/application\/case\/([A-Za-z0-9-]{1,64})\/(imm5406|imm5669)\/?$/i.exec(window.location.pathname)
    const id = new URLSearchParams(window.location.search).get('documentId')
    if (!m || !id || !/^[A-Za-z0-9-]{1,64}$/.test(id)) return null
    return `${m[1]}|${m[2].toLowerCase()}|${id}`
  } catch {
    return null
  }
}

/** Is the form open in this tab the principal applicant's own? */
export function principalFormHere(): boolean {
  if (window.location.hostname.toLowerCase() !== PR_HOST) return false
  const docs = storedDocuments()
  const key = formKeyHere()
  const pair = PRINCIPAL_PAIRS.map(([yes, other]) => [
    document.getElementById(yes) as HTMLInputElement | null,
    document.getElementById(other) as HTMLInputElement | null,
  ]).find(([yes, other]) => yes || other)
  if (pair) {
    // Principal only with the full pair there, "Yourself" checked and the
    // "on behalf of" answer not: a half-rendered or odd pair is not proof.
    const [yes, other] = pair
    const principal = !!yes && yes.checked && !!other && !other.checked
    if (key) {
      if (principal) docs.add(key)
      else docs.delete(key)
      saveDocuments()
    }
    return principal
  }
  return key !== null && docs.has(key)
}

/** Test seam: forget every remembered form. */
export function forgetPrincipalForms(): void {
  remembered.clear()
  loaded = false
  try {
    window.sessionStorage.removeItem(PRINCIPAL_KEY)
  } catch {
    // nothing stored
  }
}

/** Whether a selector's scopes (screen text, whose form) hold here, whatever its CSS finds. */
export function scopesHold(selector: string): boolean {
  const scoped = parseScopedSelector(selector)
  if (!scoped) return false
  if (scoped.page && !scoped.page.test(screenText())) return false
  if (scoped.principal && !principalFormHere()) return false
  return true
}

/**
 * The same scoped selector for another row: its CSS's trailing row number
 * replaced (`#from2 >> page=…` → `#from1 >> page=…`). Null when the CSS does
 * not end in a row number.
 */
export function rowSelector(selector: string, row: number): string | null {
  const [css, ...rest] = selector.split(SCOPE_SEPARATOR)
  const m = /^(.*\D)(\d+)$/.exec(css)
  if (!m || row < 0) return null
  return [`${m[1]}${row}`, ...rest].join(SCOPE_SEPARATOR)
}

/** The row number a row selector's CSS ends with. */
export function rowIndexOf(selector: string): number | null {
  const css = selector.split(SCOPE_SEPARATOR)[0]
  const m = /(\d+)$/.exec(css)
  return m ? Number(m[1]) : null
}

/**
 * THE DEPENDANT FORM. IRCC's PR profile (/en/application/profile/<id>, live
 * 2026-10-20) adds a dependant through an INLINE form (no dialog) opened by
 * "Add dependant": #dependantYes / #dependantNo, #dependantForm-relationship,
 * #dependantForm-familyName, #dependantForm-givenName, a date of birth that
 * REUSES the principal's own id #personalDetailsForm-dob, and "Save details".
 *
 * The form is the smallest block holding the ONE #dependantForm-relationship
 * and a "Save details" button. Null (nothing resolves) when the form is not
 * open, when there are two, when that block also holds the principal's own
 * profile fields (#profileForm-familyName, #personalDetailsForm-givenName —
 * then it is the whole page, not the form), or inside a dialog. READ-ONLY.
 */
export function dependantForm(): Element | null {
  const rel = Array.from(document.querySelectorAll('#dependantForm-relationship'))
  if (rel.length !== 1) return null
  for (let el = rel[0].parentElement; el && el !== document.body; el = el.parentElement) {
    const save = Array.from(el.querySelectorAll('button')).some((b) => /^save details$/i.test(squash(b.textContent)))
    if (!save) continue
    if (el.querySelector('#profileForm-familyName, #personalDetailsForm-givenName')) return null
    // The principal's date of birth comes first in the document (live
    // 2026-10-20): a block holding it, or holding two, is not the form.
    const dobs = el.querySelectorAll('#personalDetailsForm-dob')
    if (dobs.length > 1) return null
    const firstDob = document.querySelector('#personalDetailsForm-dob')
    if (firstDob && el.contains(firstDob)) return null
    if (inDialog(el) || el.closest('dialog, [role="dialog"]')) return null
    return el
  }
  return null
}

/** Whether the open dependant form already holds an answer (someone started it). READ-ONLY. */
export function dependantFormHasValues(form: Element): boolean {
  for (const el of Array.from(form.querySelectorAll('input, select, textarea'))) {
    const type = ((el as HTMLInputElement).type || '').toLowerCase()
    if (type === 'radio' || type === 'checkbox') {
      if ((el as HTMLInputElement).checked) return true
      continue
    }
    if (['button', 'submit', 'reset', 'hidden', 'image', 'file'].includes(type)) continue
    if (el instanceof HTMLSelectElement) {
      const opt = el.selectedIndex >= 0 ? el.options[el.selectedIndex] : undefined
      const v = (opt?.value ?? '').trim()
      if (opt && v !== '' && !/null/i.test(v) && !/^select\b/i.test(squash(opt.text))) return true
      continue
    }
    // A mask's placeholder ("____/__/__") is not a value.
    if (/[a-z0-9]/i.test((el as HTMLInputElement).value ?? '')) return true
  }
  return false
}
