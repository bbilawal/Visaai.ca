import {
  dependantForm,
  gridPaginators,
  inDialog,
  navOff,
  pageNav,
  pageRowTexts,
  rangeLabel,
  resolveTarget,
  topDialog,
  waitUntil,
} from './resolve-target'
import {
  buttonText,
  isSafeAddButton,
  isSafeChoiceTarget,
  isSafeDependantAddButton,
  isSafeDependantSave,
  isSafeDialogSave,
  isSafeInlineAddButton,
  isSafePagerButton,
  isSafeSaveAndContinue,
} from './safety-guards'

/**
 * THE ONLY CLICKING SITE IN THE EXTENSION.
 *
 * IRCC answers yes/no and multiple-choice questions with radio buttons, asks
 * for ticks in checkboxes, and adds table rows (residences, work history,
 * children) through a dialog opened by an "add" button and closed by its Save
 * button. None of those can be entered as a value, so they are clicked — and
 * only these eight kinds of target, each checked before the click:
 *
 *  - a radio input (never un-selects: clicking a selected radio is a no-op,
 *    and an already-selected one is not clicked again);
 *  - a checkbox input, only ever from unchecked to checked;
 *  - an "add" button on the page itself (not in a dialog) whose id says add;
 *  - the open dialog's own Save button;
 *  - a grid paginator's page button (first / previous / next), to read the
 *    rows on every page of a paginated grid — it changes no data;
 *  - the PR portal's inline "Add another" button, one row at a time, only
 *    for a row the reviewed data has and the page does not;
 *  - the PR profile's "Add dependant" button (exact text, type=button, the
 *    profile page only, not in a dialog), only for a reviewed dependant no
 *    saved card matches field by field, never when a card has the same
 *    family name and date of birth under another name, and only while no
 *    dependant form is open with values;
 *  - that inline dependant form's own "Save details" (exact text,
 *    type=button, enabled, inside the one open dependant form). Its Edit,
 *    Delete and Cancel are never clicked.
 *
 * And ONE page-leaving button, for the applicant's opt-in auto-advance only:
 * the IRCC Portal's (tr-rt) "Save and continue" `#next_path`, through
 * `pressSaveAndContinue` / `isSafeSaveAndContinue` — on an allow-listed tr-rt
 * form page only (never /summary or anything after it), with no dialog open,
 * at most once per page. Every other guard still refuses it.
 *
 * `safety-guards.ts` refuses anything else that leaves the page or commits the
 * application (`#next_path` outside that one guard, Back, anything saying
 * continue / sign / pay / transmit). Payment, signature and final submission
 * have no code path here or anywhere else in the extension.
 */
export type ActOutcome =
  | { done: true; node: Element }
  | { done: false; reason: 'selector_missing' | 'unsafe_target' }

/** Select a radio answer. Clicking is how Angular Material registers it. */
export function chooseRadio(el: Element): ActOutcome {
  if (!isSafeChoiceTarget(el, 'radio')) return { done: false, reason: 'unsafe_target' }
  const input = el as HTMLInputElement
  if (!input.checked) input.click()
  return { done: true, node: el }
}

/** Tick a checkbox. Never un-ticks: an already-ticked box is left alone. */
export function ensureChecked(el: Element): ActOutcome {
  if (!isSafeChoiceTarget(el, 'checkbox')) return { done: false, reason: 'unsafe_target' }
  const input = el as HTMLInputElement
  if (!input.checked) input.click()
  return { done: true, node: el }
}

/** Open a table's "add row" dialog. */
export function openRowDialog(el: Element): ActOutcome {
  if (!isSafeAddButton(el, inDialog(el))) return { done: false, reason: 'unsafe_target' }
  ;(el as HTMLElement).click()
  return { done: true, node: el }
}

/**
 * The page's ONE inline "Add another" button (PR portal), or why not: none,
 * or several (two sections on one screen — which one is not a guess).
 */
export function findInlineAddButton(): ActOutcome {
  const hits = Array.from(document.querySelectorAll('button')).filter((b) => isSafeInlineAddButton(b))
  if (hits.length === 0) return { done: false, reason: 'selector_missing' }
  if (hits.length > 1) return { done: false, reason: 'unsafe_target' }
  return { done: true, node: hits[0] }
}

/** Add one inline row (PR portal "Add another", found with findInlineAddButton). */
export function addInlineRow(el: Element): ActOutcome {
  if (!isSafeInlineAddButton(el)) return { done: false, reason: 'unsafe_target' }
  ;(el as HTMLElement).click()
  return { done: true, node: el }
}

/** Pseudo-selectors of the PR profile's dependant steps (op dependant_open / dependant_save). */
export const DEPENDANT_ADD = '::dependant-add'
export const DEPENDANT_SAVE = '::dependant-save'

/** The profile's ONE "Add dependant" button, or why not: none, or several. */
export function findDependantAddButton(): ActOutcome {
  const hits = Array.from(document.querySelectorAll('button')).filter((b) => isSafeDependantAddButton(b))
  if (hits.length === 0) return { done: false, reason: 'selector_missing' }
  if (hits.length > 1) return { done: false, reason: 'unsafe_target' }
  return { done: true, node: hits[0] }
}

/** Open the inline dependant form (button found with findDependantAddButton). */
export function openDependantForm(el: Element): ActOutcome {
  if (!isSafeDependantAddButton(el)) return { done: false, reason: 'unsafe_target' }
  ;(el as HTMLElement).click()
  return { done: true, node: el }
}

/** The open dependant form's one "Save details" button (it may still be disabled: checked at the click). */
export function findDependantSave(): ActOutcome {
  const form = dependantForm()
  if (!form) return { done: false, reason: 'selector_missing' }
  const hits = Array.from(form.querySelectorAll('button')).filter((b) => /^save details$/i.test(buttonText(b)))
  if (hits.length === 0) return { done: false, reason: 'selector_missing' }
  if (hits.length > 1) return { done: false, reason: 'unsafe_target' }
  return { done: true, node: hits[0] }
}

/** Click "Save details" of the open dependant form — only through isSafeDependantSave. */
export function saveDependantForm(el: Element): ActOutcome {
  const form = dependantForm()
  if (!form || !isSafeDependantSave(el, form)) return { done: false, reason: 'unsafe_target' }
  ;(el as HTMLElement).click()
  return { done: true, node: el }
}

/** The pseudo-selector for "the open dialog's Save button, by its text". */
export const DIALOG_SAVE = '::dialog-save'

/** Find the open dialog's Save button: by selector, or by its text. */
export function findDialogSave(selector: string): ActOutcome {
  const dialog = topDialog()
  if (!dialog) return { done: false, reason: 'selector_missing' }
  let el: Element | null = null
  if (selector === DIALOG_SAVE) {
    const hits = Array.from(dialog.querySelectorAll('button')).filter((b) => /\bsave\b/i.test(buttonText(b)))
    if (hits.length === 0) return { done: false, reason: 'selector_missing' }
    if (hits.length > 1) return { done: false, reason: 'unsafe_target' }
    el = hits[0]
  } else {
    const r = resolveTarget(selector, dialog)
    if (r.status === 'ambiguous') return { done: false, reason: 'unsafe_target' }
    if (r.status !== 'found') return { done: false, reason: 'selector_missing' }
    el = r.el
  }
  if (!isSafeDialogSave(el, dialog)) return { done: false, reason: 'unsafe_target' }
  return { done: true, node: el }
}

/** Click the open dialog's Save button (found with findDialogSave). */
export function saveRowDialog(el: Element): ActOutcome {
  const dialog = topDialog()
  if (!dialog || !isSafeDialogSave(el, dialog)) return { done: false, reason: 'unsafe_target' }
  ;(el as HTMLElement).click()
  return { done: true, node: el }
}

/**
 * Turn one page (no data changes) and wait for the grid to show it: its range
 * label changes. False when the button is off or the page never changed.
 */
async function turnPage(p: Element, which: 'first' | 'previous' | 'next'): Promise<boolean> {
  const b = pageNav(p, which)
  if (navOff(b)) return false
  // A refused page button is not "no more pages": reading on would give the
  // duplicate-row check a partial list and a row could be added twice.
  if (!isSafePagerButton(b!, p)) throw new Error('unsafe pager button')
  const before = rangeLabel(p)
  b!.click()
  return waitUntil(() => rangeLabel(p) !== before, 2000, 50)
}

/** Back to a grid's first page: "first" when it has one, else "previous" until it stops. */
async function toFirstPage(p: Element): Promise<void> {
  if (pageNav(p, 'first')) {
    await turnPage(p, 'first')
    return
  }
  for (let i = 0; i < 50 && (await turnPage(p, 'previous')); i++);
}

/**
 * Text of every data row behind any dialog, on every page of a paginated
 * grid. Turns the grid's pages (no data changes) and leaves it on its first
 * page.
 */
export async function allPageRowTexts(): Promise<string[]> {
  const out = pageRowTexts()
  for (const p of gridPaginators()) {
    // One page only: nothing to turn.
    if (navOff(pageNav(p, 'next')) && navOff(pageNav(p, 'previous')) && navOff(pageNav(p, 'first'))) continue
    await toFirstPage(p)
    out.push(...pageRowTexts())
    for (let i = 0; i < 50 && (await turnPage(p, 'next')); i++) out.push(...pageRowTexts())
    await toFirstPage(p)
  }
  return out
}

/**
 * The page path "Save and continue" was last pressed on. A second press on
 * the same path (IRCC kept the page: a validation error, a reload) is refused
 * until another page was pressed — at most one press per page.
 */
let pressedOnPath: string | null = null

/**
 * AUTO-ADVANCE: press the IRCC Portal's "Save and continue" (#next_path).
 * Refused unless the page has exactly one #next_path, no dialog is open, it
 * passes isSafeSaveAndContinue (tr-rt host, allow-listed form page, exact
 * text, enabled, visible), and it was not already pressed on this page.
 */
export function pressSaveAndContinue(): ActOutcome {
  const hits = document.querySelectorAll('#next_path')
  if (hits.length === 0) return { done: false, reason: 'selector_missing' }
  if (hits.length > 1) return { done: false, reason: 'unsafe_target' }
  const el = hits[0]
  if (topDialog()) return { done: false, reason: 'unsafe_target' }
  if (!isSafeSaveAndContinue(el)) return { done: false, reason: 'unsafe_target' }
  const path = el.ownerDocument.defaultView?.location.pathname ?? null
  if (!path || path === pressedOnPath) return { done: false, reason: 'unsafe_target' }
  pressedOnPath = path
  ;(el as HTMLElement).click()
  return { done: true, node: el }
}
