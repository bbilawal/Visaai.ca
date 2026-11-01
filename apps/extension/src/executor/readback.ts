/**
 * Phase 7H — Readback bridge. READ-ONLY.
 *
 * After a settle delay (lets controlled-input frameworks re-render), reads the
 * field's value and applies trim + NFC normalization ONLY (no hashing here — the
 * ReadbackEngine hashes/compares). Detects post-write portal mutation by checking
 * the readback node is the same node that was written.
 *
 * `mode` says what "the value" of the control is:
 *  - 'value'  — its value (text box, select by value);
 *  - 'option' — the text of the selected option (select by text), read as
 *    `answer` when it is that text up to case and spacing;
 *  - 'checked'— whether it is selected (radio, checkbox). A checked control
 *    reads back as the answer it stands for (`answer`), an unchecked one as
 *    '' — so verification compares the answer the server expects with the
 *    answer the page now shows.
 */
import { resolveTarget } from './resolve-target'

export interface ReadbackOutcome {
  found: boolean
  sameNode: boolean
  value: string
}

export async function readField(
  selector: string,
  writtenNode: Element | undefined,
  settleMs = 250,
  root: ParentNode = document,
  mode: 'value' | 'option' | 'checked' = 'value',
  answer = '',
): Promise<ReadbackOutcome> {
  await new Promise(resolve => setTimeout(resolve, settleMs))
  // Invalid, absent or ambiguous all read as not found: the first of several
  // matches is not "the field".
  const target = resolveTarget(selector, root)
  if (target.status !== 'found') return { found: false, sameNode: false, value: '' }
  const el = target.el
  const sameNode = writtenNode ? el === writtenNode : true
  // READ ONLY — never assigns. Normalize: trim + NFC (no hash).
  let raw: string
  if (mode === 'checked') {
    raw = (el as HTMLInputElement).checked ? answer : ''
  } else if (mode === 'option') {
    const sel = el as HTMLSelectElement
    const opt = sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex] : undefined
    const text = (opt?.text ?? '').replace(/\s+/g, ' ').trim()
    // Same comparison the writer chose the option by (case-folded): the
    // reviewed "Family member" is the option IRCC labels "Family Member".
    raw = text.toLowerCase() === answer.replace(/\s+/g, ' ').trim().toLowerCase() ? answer : text
  } else {
    raw = (el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value ?? ''
  }
  return { found: true, sameNode, value: raw.trim().normalize('NFC') }
}
