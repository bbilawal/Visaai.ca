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
// control is never clicked, whatever selector names it.
const NEVER_CLICK = /\b(continue|next|submit|sign|pay|payment|transmit|send|delete|remove|back|previous|cancel)\b/i
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

/** The open dialog's Save button: inside the dialog, says Save, nothing page-leaving. */
export function isSafeDialogSave(el: Element, dialog: Element): boolean {
  if (!isPlainButton(el) || !dialog.contains(el)) return false
  const text = buttonText(el)
  if (!/\bsave\b/i.test(text)) return false
  return !/continue|next|submit|sign|pay|transmit/i.test(text)
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
