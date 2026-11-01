import { resolveTarget } from './resolve-target'
import { isSafeWriteTarget } from './safety-guards'

/**
 * Phase 7H — Field Executor. THE ONLY VALUE-WRITE SITE IN THE SYSTEM.
 *
 * Writes a single value into a single data field via the native value setter (so
 * React/Angular controlled inputs accept it) + input/change/blur events (IRCC's
 * Angular forms validate on blur). It performs no page actions of any other
 * kind and only targets plain data inputs — button, file, password, radio and
 * checkbox controls are rejected by safety-guards. Write-only; readback +
 * verification live elsewhere. Returns the captured node so readback can detect
 * portal mutation.
 *
 * Choosing a radio answer, ticking a checkbox and opening/saving a table dialog
 * are actuations, not value writes; they live in control-actuator.ts.
 */
export interface WriteOutcome {
  written: boolean
  reason?: 'selector_missing' | 'unsafe_target'
  node?: Element
}

function resolveWritable(selector: string, root: ParentNode): WriteOutcome | Element {
  // Invalid or absent: nothing identifies a field. Ambiguous: several do, and
  // writing the first would verify a value in whichever field that happens to be.
  const target = resolveTarget(selector, root)
  if (target.status === 'ambiguous') return { written: false, reason: 'unsafe_target' }
  if (target.status !== 'found') return { written: false, reason: 'selector_missing' }
  if (!isSafeWriteTarget(target.el)) return { written: false, reason: 'unsafe_target' }
  return target.el
}

function setNative(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto =
    input instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : input instanceof HTMLSelectElement
        ? window.HTMLSelectElement.prototype
        : window.HTMLInputElement.prototype
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (nativeSetter) nativeSetter.call(input, value)
  else input.value = value

  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  input.dispatchEvent(new Event('blur', { bubbles: true }))
}

export function executeWrite(selector: string, value: string, root: ParentNode = document): WriteOutcome {
  const el = resolveWritable(selector, root)
  if (!(el instanceof Element)) return el
  setNative(el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value)
  return { written: true, node: el }
}

/** Option text as shown, collapsed and case-folded for comparison. */
export function optionLabel(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Choose the <select> option whose visible text is `text` (IRCC's option
 * values are internal codes; the reviewed value is the text the applicant
 * sees, e.g. "Family member"). Exactly one option must match; otherwise
 * nothing is written.
 */
export function executeSelectByText(selector: string, text: string, root: ParentNode = document): WriteOutcome {
  const el = resolveWritable(selector, root)
  if (!(el instanceof Element)) return el
  if (!(el instanceof HTMLSelectElement)) return { written: false, reason: 'unsafe_target' }
  const want = optionLabel(text)
  const hits = Array.from(el.options).filter((o) => optionLabel(o.text) === want)
  if (hits.length !== 1) return { written: false, reason: 'selector_missing' }
  setNative(el, hits[0].value)
  return { written: true, node: el }
}
