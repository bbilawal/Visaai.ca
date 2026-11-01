import { inDialog, resolveTarget, topDialog } from './resolve-target'
import { buttonText, isSafeAddButton, isSafeChoiceTarget, isSafeDialogSave } from './safety-guards'

/**
 * THE ONLY CLICKING SITE IN THE EXTENSION.
 *
 * IRCC answers yes/no and multiple-choice questions with radio buttons, asks
 * for ticks in checkboxes, and adds table rows (residences, work history,
 * children) through a dialog opened by an "add" button and closed by its Save
 * button. None of those can be entered as a value, so they are clicked — and
 * only these four kinds of target, each checked before the click:
 *
 *  - a radio input (never un-selects: clicking a selected radio is a no-op,
 *    and an already-selected one is not clicked again);
 *  - a checkbox input, only ever from unchecked to checked;
 *  - an "add" button on the page itself (not in a dialog) whose id says add;
 *  - the open dialog's own Save button.
 *
 * `safety-guards.ts` refuses anything that leaves the page or commits the
 * application ("Save and continue" `#next_path`, Back, anything saying
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
