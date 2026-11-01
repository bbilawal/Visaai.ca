import { optionKey, resolveTarget } from './resolve-target'
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
  // no_option included: never set a value the list does not have (the
  // select would be cleared and the applicant's own answer lost).
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
  return optionKey(text)
}

/**
 * Choose the <select> option whose visible text is `text` (IRCC's option
 * values are internal codes; the reviewed value is the text the applicant
 * sees, e.g. "Family member"). Exactly one option must match; otherwise
 * nothing is written. An option that is already chosen is not chosen again.
 */
export function executeSelectByText(selector: string, text: string, root: ParentNode = document): WriteOutcome {
  const el = resolveWritable(selector, root)
  if (!(el instanceof Element)) return el
  if (!(el instanceof HTMLSelectElement)) return { written: false, reason: 'unsafe_target' }
  const want = optionLabel(text)
  const hits = Array.from(el.options).filter((o) => optionLabel(o.text) === want)
  if (hits.length !== 1) return { written: false, reason: 'selector_missing' }
  // Already the chosen option: leave it. A single-page form (IRCC eTA) is
  // filled again by every launch as more of it appears, and re-firing
  // change on an answered question can make the form reset what follows it.
  // The readback still verifies the shown text like any write.
  if (el.selectedIndex >= 0 && el.options[el.selectedIndex] === hits[0]) return { written: true, node: el }
  setNative(el, hits[0].value)
  return { written: true, node: el }
}

/**
 * A <select> whose list may still be loading: exactly one select is there,
 * and it is disabled or does not list the option yet. (Two matching options,
 * or no select at all, is not loading — waiting would not help.)
 */
function listStillLoading(selector: string, text: string, root: ParentNode): boolean {
  const target = resolveTarget(selector, root)
  if (target.status !== 'found' || !(target.el instanceof HTMLSelectElement)) return false
  const want = optionLabel(text)
  const hits = Array.from(target.el.options).filter((o) => optionLabel(o.text) === want).length
  return hits === 0 || (hits === 1 && target.el.disabled)
}

/**
 * `executeSelectByText` for a select whose options arrive after an earlier
 * answer (IRCC eTA, live 2026-10-18: the job-title list loads 1–5 s after the
 * occupation group is chosen). While the select is there but does not list
 * the option yet (or is disabled while it loads), look again until
 * `waitMs`; then answer exactly as `executeSelectByText` does. Never chooses
 * anything but the one option whose text is `text`. Stops looking as soon as
 * `stillActive` says the run is gone (the extension reloaded) or the select
 * leaves the page. Only for a write marked `awaitOptions` (content.ts).
 */
export async function executeSelectByTextWhenListed(
  selector: string,
  text: string,
  root: ParentNode = document,
  waitMs = 8000,
  intervalMs = 100,
  stillActive: () => boolean = () => true,
): Promise<WriteOutcome> {
  const deadline = Date.now() + waitMs
  for (;;) {
    const out = executeSelectByText(selector, text, root)
    if (
      out.written ||
      !listStillLoading(selector, text, root) ||
      Date.now() >= deadline ||
      !stillActive()
    )
      return out
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

/**
 * May a `keep` row box be written? Only when it is empty or already holds the
 * reviewed value — the applicant's own row, an earlier answer, is never
 * overwritten. Two IRCC PR-portal quirks (live 2026-10-21, IMM 5669 Section H)
 * are not values:
 *  - an empty masked date box holds its mask (`____/__`, `____/__/__`);
 *  - the portal pre-fills the current address row from the profile and, with
 *    no street number, writes "null " before the street name. That is the
 *    same street, so the clean value may replace it.
 */
export function keepAllowsWrite(current: string, mapped: string): boolean {
  const now = current.trim().normalize('NFC')
  const want = mapped.trim().normalize('NFC')
  // A mask has at least one '_'; a bare "-" or "." is the applicant's own entry.
  if (now === '' || /^(?=.*_)[_/\s.-]+$/.test(now)) return true
  if (now === want) return true
  return /^null\s+/i.test(now) && now.replace(/^null\s+/i, '') === want
}
