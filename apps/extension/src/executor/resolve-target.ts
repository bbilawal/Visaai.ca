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

export function resolveTarget(selector: string, root: ParentNode = document): TargetResolution {
  if (typeof selector !== 'string' || selector === '') return { status: 'invalid' }
  let matches: NodeListOf<Element>
  try {
    matches = root.querySelectorAll(selector)
  } catch {
    return { status: 'invalid' }
  }
  if (matches.length === 0) return { status: 'missing' }
  if (matches.length > 1) return { status: 'ambiguous' }
  return { status: 'found', el: matches[0] }
}

const DIALOG_SELECTOR = 'mat-dialog-container, [role="dialog"], [role="alertdialog"]'

/** The open dialog on top (last in document order), or null. READ-ONLY. */
export function topDialog(): Element | null {
  const all = document.querySelectorAll(DIALOG_SELECTOR)
  return all.length ? all[all.length - 1] : null
}

/** Whether an element sits inside a dialog or the overlay layer. */
export function inDialog(el: Element): boolean {
  return !!el.closest(`${DIALOG_SELECTOR}, .cdk-overlay-container`)
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
): Promise<TargetResolution> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const root = scope()
    const r = root ? resolveTarget(selector, root) : ({ status: 'missing' } as const)
    if (r.status !== 'missing') return r
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
