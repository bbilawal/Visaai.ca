/**
 * Phase 7H — Safety guards. The executor may write ONLY to plain data inputs.
 * It must never target a submit/button/file control, never submit a form,
 * never navigate. These guards make those targets unwritable; the absence of
 * any submit/navigation call is enforced by execution-path-invariant.
 *
 * Choice controls (radio, checkbox) are not data inputs: setting their `value`
 * changes what they would send, not whether they are selected, and reading
 * that value back would "verify" an answer that was never given. They are
 * refused here and operated only by control-actuator.ts (`isSafeChoiceTarget`).
 */

import { TRRT_HOST, isAutoAdvancePath } from '../trrt-pages'

const WRITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])
// input types that must NEVER be written/actuated by the value writer.
// `hidden` because the applicant must be able to review every value written:
// a hidden input carries its value to the server unseen.
const FORBIDDEN_INPUT_TYPES = new Set([
  'submit',
  'button',
  'image',
  'reset',
  'file',
  'password',
  'hidden',
  'radio',
  'checkbox',
])

/** True only for a plain data field that is safe to fill (never a submit control). */
export function isSafeWriteTarget(el: Element): boolean {
  if (!WRITABLE_TAGS.has(el.tagName)) return false
  if (el.tagName === 'INPUT') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase()
    if (FORBIDDEN_INPUT_TYPES.has(type)) return false
  }
  // Never write into a disabled/readonly control.
  const ctl = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  if (ctl.disabled) return false
  if ('readOnly' in ctl && (ctl as HTMLInputElement).readOnly) return false
  // Never write a value the applicant cannot see, and so cannot review.
  if (!isVisible(el)) return false
  return true
}

/**
 * A radio or checkbox the applicant can see and change. Material renders the
 * native input visually hidden (opacity 0 / 1px clip) behind its own circle,
 * which `isVisible` deliberately tolerates; `display:none` / `hidden` still
 * refuse it.
 */
export function isSafeChoiceTarget(el: Element, type: 'radio' | 'checkbox'): boolean {
  if (el.tagName !== 'INPUT') return false
  const input = el as HTMLInputElement
  if ((input.type || '').toLowerCase() !== type) return false
  if (input.disabled) return false
  return isVisible(el)
}

/** Text a button shows, collapsed. */
export function buttonText(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim()
}

// Words on a control that leaves the page or commits the application. Such a
// control is never clicked, whatever selector names it. IRCC's Permanent
// Residence Portal adds "Complete and return to application" (ends a form)
// and the consent and declaration (the applicant's e-signature).
const NEVER_CLICK =
  /\b(continue|next|submit|sign|pay|payment|transmit|send|delete|remove|back|previous|cancel|complete|consent)\b|\bdeclar|return to (the )?application/i
const NEVER_CLICK_IDS = /^(next_path|previous_path)$/i

/** A visible, enabled button (or input type=button) that is not a page-leaving control. */
function isPlainButton(el: Element): boolean {
  const tag = el.tagName
  const isBtn = tag === 'BUTTON' || (tag === 'INPUT' && (el as HTMLInputElement).type.toLowerCase() === 'button')
  if (!isBtn) return false
  if ((el as HTMLButtonElement).disabled) return false
  if (NEVER_CLICK_IDS.test(el.id)) return false
  if (!isVisible(el)) return false
  return true
}

/** The table's "add" button: on the page (not in a dialog), id says add, text says nothing else. */
export function isSafeAddButton(el: Element, inDialog: boolean): boolean {
  if (!isPlainButton(el) || inDialog) return false
  if (!/add/i.test(el.id)) return false
  return !NEVER_CLICK.test(buttonText(el))
}

/**
 * IRCC Permanent Residence Portal's inline "Add another" (IMM 5669 education,
 * personal history, addresses — live 2026-10-20): a plain type="button" with
 * no id that adds one empty row of indexed fields below the last. Only that:
 * on the PR portal's own host, visible and enabled, not in a dialog, its
 * visible text exactly "Add another". It saves nothing and leaves nothing.
 */
export function isSafeInlineAddButton(el: Element): boolean {
  if (el.ownerDocument.defaultView?.location.hostname.toLowerCase() !== 'prson-srpel.apps.cic.gc.ca') return false
  if (!isPlainButton(el)) return false
  if ((el as HTMLButtonElement).type !== 'button') return false
  if (el.closest('dialog, [role="dialog"], mat-dialog-container, .cdk-overlay-container')) return false
  const text = buttonText(el)
  return /^add another$/i.test(text) && !NEVER_CLICK.test(text)
}

const PR_HOST = 'prson-srpel.apps.cic.gc.ca'
const PR_PROFILE_PATH = /^\/en\/application\/profile\/\d+\/?$/i

/** On the PR portal's own host, on the applicant's profile page. */
function onPrProfile(el: Element): boolean {
  const loc = el.ownerDocument.defaultView?.location
  return loc?.hostname.toLowerCase() === PR_HOST && PR_PROFILE_PATH.test(loc.pathname)
}

const IN_DIALOG = 'dialog, [role="dialog"], [role="alertdialog"], mat-dialog-container, .cdk-overlay-container'

/**
 * IRCC PR profile's "Add dependant" (live 2026-10-20): a type="button" with
 * no id that opens an inline dependant form — it saves nothing and leaves
 * nothing. Only that: on the PR host's profile page, visible and enabled, not
 * in a dialog, its visible text exactly "Add dependant".
 */
export function isSafeDependantAddButton(el: Element): boolean {
  if (!onPrProfile(el)) return false
  if (!isPlainButton(el)) return false
  if ((el as HTMLButtonElement).type !== 'button') return false
  if (el.closest(IN_DIALOG)) return false
  const text = buttonText(el)
  return /^add dependant$/i.test(text) && !NEVER_CLICK.test(text)
}

/**
 * The open inline dependant form's "Save details" (live 2026-10-20): it
 * closes the form and lists the dependant as a card; the profile itself is
 * saved only by the page's "Save and continue", which stays the applicant's.
 * Only that: on the PR profile page, a type="button" (never the form's
 * submit), visible and ENABLED (IRCC enables it once the form is valid),
 * inside the given dependant form, not in a dialog, text exactly
 * "Save details". Never Edit, Delete, Cancel or "Save and continue".
 */
export function isSafeDependantSave(el: Element, form: Element): boolean {
  if (!onPrProfile(el)) return false
  if (!isPlainButton(el) || !form.contains(el)) return false
  if ((el as HTMLButtonElement).type !== 'button') return false
  if (el.closest(IN_DIALOG)) return false
  const text = buttonText(el)
  return /^save details$/i.test(text) && !NEVER_CLICK.test(text)
}

/** The open dialog's Save button: inside the dialog, says Save, nothing page-leaving. */
export function isSafeDialogSave(el: Element, dialog: Element): boolean {
  if (!isPlainButton(el) || !dialog.contains(el)) return false
  const text = buttonText(el)
  if (!/\bsave\b/i.test(text)) return false
  return !/continue|next|submit|sign|pay|transmit|complete|consent|declar/i.test(text)
}

/**
 * A grid paginator's page button: a plain button inside a mat-paginator on
 * the page (not in a dialog), the paginator given. Turning a page changes no
 * data; anything page-leaving is still refused.
 */
export function isSafePagerButton(el: Element, paginator: Element): boolean {
  if (!isPlainButton(el) || !paginator.contains(el)) return false
  // A typeless button in a form submits it; Material sets type="button".
  if ((el as HTMLButtonElement).type !== 'button') return false
  if (paginator.tagName !== 'MAT-PAGINATOR' || !!el.closest('mat-dialog-container, .cdk-overlay-container')) return false
  return !NEVER_CLICK.test(buttonText(el))
}

/**
 * AUTO-ADVANCE ONLY (owner decision 2026-10-31): the IRCC Portal's "Save and
 * continue" — and nothing else that leaves a page. Only that: on the tr-rt
 * host itself, on an allow-listed form page (trrt-pages.ts: never /summary,
 * documents, fees, consent, signature, submission, payment, /error or an
 * unknown page), a <button> whose id is exactly `next_path`, type button or
 * submit, visible and enabled, not in any dialog, its visible text exactly
 * "Save and continue" (its Material icon ligature, `arrow_forward` in a
 * <mat-icon>, is not text the applicant reads and is left out — live
 * 2026-10-31). Every other guard here still refuses #next_path
 * (NEVER_CLICK_IDS), so no other path can reach it.
 */
export function isSafeSaveAndContinue(el: Element): boolean {
  const loc = el.ownerDocument.defaultView?.location
  if (!loc || loc.protocol !== 'https:' || loc.hostname.toLowerCase() !== TRRT_HOST) return false
  if (!isAutoAdvancePath(loc.pathname)) return false
  if (el.tagName !== 'BUTTON' || el.id !== 'next_path') return false
  const b = el as HTMLButtonElement
  if (b.disabled || b.getAttribute('aria-disabled') === 'true') return false
  const type = (b.getAttribute('type') ?? 'submit').toLowerCase()
  if (type !== 'button' && type !== 'submit') return false
  if (el.closest(IN_DIALOG)) return false
  if (!/^save and continue$/i.test(textWithoutIcons(el))) return false
  return isVisible(el)
}

const ICON = 'mat-icon, .material-icons'

/** buttonText, less the text of icon-ligature elements inside the button. */
function textWithoutIcons(el: Element): string {
  const copy = el.cloneNode(true) as Element
  copy.querySelectorAll(ICON).forEach((i) => i.remove())
  return buttonText(copy)
}

/**
 * Rendered, as far as CSS says. Checked by hand (display:none or `hidden` on
 * the element or any ancestor; visibility on the element, which inherits) so
 * the rule is the same everywhere, then by `checkVisibility()` where the
 * browser has it (Chrome 105+), which also covers content-visibility. Opacity
 * is deliberately not checked: custom-styled selects hide the native control
 * with opacity 0 and render its value in a visible replica.
 */
function isVisible(el: Element): boolean {
  const view = el.ownerDocument.defaultView
  if (!view) return false
  for (let n: Element | null = el; n; n = n.parentElement) {
    if ((n as HTMLElement).hidden) return false
    if (view.getComputedStyle(n).display === 'none') return false
  }
  const v = view.getComputedStyle(el).visibility
  if (v === 'hidden' || v === 'collapse') return false
  const check = (el as Element & { checkVisibility?: (o?: object) => boolean }).checkVisibility
  if (typeof check === 'function' && !check.call(el, { visibilityProperty: true, checkVisibilityCSS: true })) return false
  return true
}

/**
 * A <select> that is disabled only while its option list loads (IRCC eTA job
 * title, after the occupation group changes). Present for a write that waits
 * for its options (`awaitOptions`); the write itself still refuses it until it
 * is enabled. Never hidden.
 */
export function isSelectAwaitingOptions(el: Element): boolean {
  return el instanceof HTMLSelectElement && el.disabled && isVisible(el)
}
