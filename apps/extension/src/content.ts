import type { ExtMessage, PortalFillFieldResult, PortalFillOp, PortalFillWriteCommand, ReadbackResult } from './shared'
import { isPortalFillProtocolCompatible, PORTAL_FILL_PROTOCOL_VERSION } from './shared'
import { dryRunField } from './portal-fill-executor'
import { executeSelectByText, executeWrite, type WriteOutcome } from './executor/field-executor'
import { readField } from './executor/readback'
import { verifyField } from './readback-engine'
import { inDialog, pageRowCount, resolveTarget, topDialog, waitForTarget, waitUntil } from './executor/resolve-target'
import { isSafeAddButton, isSafeChoiceTarget, isSafeWriteTarget } from './executor/safety-guards'
import {
  chooseRadio,
  DIALOG_SAVE,
  ensureChecked,
  findDialogSave,
  openRowDialog,
  saveRowDialog,
  type ActOutcome,
} from './executor/control-actuator'

/**
 * Content script.
 *
 * THIS FILE DRIVES WRITES TO THE PORTAL. It routes; it does not write. What is
 * actually true:
 *
 *  - `execute-field-intent` performs ONE step, then reads it back and verifies
 *    it against a hash the server computed. Step → readback → verify,
 *    fail-closed at every step. A value goes in through `field-executor.ts`
 *    (the only value writer); a radio answer, a checkbox tick and an "add row"
 *    dialog's open/Save go through `control-actuator.ts` (the only clicker).
 *    `safety-guards.ts` rejects button, file, password and hidden controls,
 *    anything not visible, and any control that leaves the page or commits the
 *    application; `resolve-target.ts` refuses a selector that is invalid or
 *    matches more than one element.
 *  - A step that only appears after an earlier one (a follow-up question, a
 *    field in a dialog) is waited for, briefly, and fails as missing if it
 *    never appears.
 *  - `readback` and `field-readback` are read-only.
 *  - It never navigates, uploads, or submits. "Save and continue", payment,
 *    signature and final submission have no code path here.
 *  - Intents arrive only from the background service worker, only for the tab
 *    bound to the session, and only after the server has authorized the
 *    execution.
 *
 * The legacy 'execute-step' message is retained only to return an explicit
 * deprecation result to any stale caller — it performs no mutation.
 */
chrome.runtime.onMessage.addListener((msg: ExtMessage, sender, sendResponse) => {
  // Only this extension's own worker. Page script has no chrome.runtime, so
  // this is defence in depth, not the boundary.
  if (sender.id !== chrome.runtime.id) return false

  // READ-ONLY readback (the bridge's pre-flight probe).
  if (msg.type === 'readback') {
    sendResponse(readbackFields(msg.selectors, msg.ops))
    return true
  }

  // Phase 7E — portal-fill executor SCAFFOLD (read-only dry run). Protocol
  // handshake first; then a read-only field inspection (NO write/mutation).
  if (msg.type === 'portal-fill-dry') {
    if (!isPortalFillProtocolCompatible(msg.command.protocol)) {
      sendResponse({ ok: false, detail: 'protocol_mismatch' })
      return true
    }
    void dryRunField(msg.command)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, detail: 'dry_run_failed' }))
    return true
  }

  // Phase 7H — execute one signed field intent: write → readback → verify.
  // Pure routing; the write lives in field-executor, readback in readback,
  // verify in readback-engine. Fail-closed on any failure. Never submits.
  if (msg.type === 'execute-field-intent') {
    // Always answer. An unanswered port stalls the run for the bridge's full
    // timeout and then blames the transport for what was a failed field.
    void runFieldIntent(msg.command)
      .then(sendResponse)
      .catch(() =>
        sendResponse({
          protocol: PORTAL_FILL_PROTOCOL_VERSION,
          kind: 'field_result',
          executionId: msg.command?.executionId ?? '',
          fieldKey: msg.command?.fieldKey ?? '',
          outcome: 'failed',
          reason: 'dom_change',
          selectorFound: false,
        } satisfies PortalFillFieldResult),
      )
    return true
  }

  // Phase 7H — read-only readback request.
  if (msg.type === 'field-readback') {
    void readField(msg.selector, undefined)
      .then(rb =>
        sendResponse({ selector: msg.selector, value: rb.value, found: rb.found } satisfies ReadbackResult),
      )
      .catch(() => sendResponse({ selector: msg.selector, value: '', found: false } satisfies ReadbackResult))
    return true
  }

  // Legacy fill — permanently inert. No DOM mutation under any condition.
  if (msg.type === 'execute-step') {
    sendResponse({ ok: false, detail: 'LEGACY_EXECUTION_DEPRECATED' })
    return true
  }

  return false
})

/** How long a revealed field or a dialog may take to appear / close. */
const APPEAR_MS = 5000

async function runFieldIntent(cmd: PortalFillWriteCommand): Promise<PortalFillFieldResult> {
  const base = {
    protocol: PORTAL_FILL_PROTOCOL_VERSION,
    kind: 'field_result' as const,
    executionId: cmd.executionId,
    fieldKey: cmd.fieldKey,
  }
  const failed = (reason: PortalFillFieldResult['reason'], selectorFound = false): PortalFillFieldResult => ({
    ...base,
    outcome: 'failed',
    reason,
    selectorFound,
  })
  if (!isPortalFillProtocolCompatible(cmd.protocol)) return failed('dom_change')

  // A dialog field lives in the open dialog and is looked up there only.
  const scope = (): ParentNode | null => (cmd.dialog ? topDialog() : document)
  const root = scope()
  if (!root) return failed('selector_missing')

  let readMode: 'value' | 'option' | 'checked' = 'value'
  let node: Element | undefined

  if (cmd.op === 'dialog_save') {
    const found = findDialogSave(cmd.selector)
    if (!found.done) return failed(found.reason)
    const before = pageRowCount()
    const saved = saveRowDialog(found.node)
    if (!saved.done) return failed(saved.reason, true)
    // Saved = the dialog closed and the table behind it gained a row. A
    // dialog that stays open is IRCC refusing the row (a required field).
    const ok = await waitUntil(() => !topDialog() && pageRowCount() > before, APPEAR_MS)
    if (!ok) return failed('controlled_rejected', true)
    return verified(base, cmd.mappedValue, cmd.expectedValueHash)
  }

  // Locate. A revealed or dialog target is waited for; anything else must be
  // there now (the probe already said it was).
  const target =
    cmd.reveal || cmd.dialog ? await waitForTarget(cmd.selector, scope, APPEAR_MS) : resolveTarget(cmd.selector, root)
  if (target.status === 'ambiguous') return failed('unsafe_target')
  if (target.status !== 'found') return failed('selector_missing')
  const here = scope() ?? document

  if (cmd.op === 'dialog_open') {
    const opened = openRowDialog(target.el)
    if (!opened.done) return failed(opened.reason, true)
    if (!(await waitUntil(() => topDialog() !== null, APPEAR_MS))) return failed('dom_change', true)
    return verified(base, cmd.mappedValue, cmd.expectedValueHash)
  }

  if (cmd.op === 'radio' || cmd.op === 'check') {
    const act: ActOutcome = cmd.op === 'radio' ? chooseRadio(target.el) : ensureChecked(target.el)
    if (!act.done) return failed(act.reason, true)
    node = act.node
    readMode = 'checked'
  } else {
    const w: WriteOutcome =
      cmd.op === 'select_text'
        ? executeSelectByText(cmd.selector, cmd.mappedValue, here)
        : executeWrite(cmd.selector, cmd.mappedValue, here)
    if (!w.written) return failed(w.reason ?? 'selector_missing')
    node = w.node
    if (cmd.op === 'select_text') readMode = 'option'
  }

  // READBACK (read-only) — detect mutation
  const rb = await readField(cmd.selector, node, 250, scope() ?? document, readMode, cmd.mappedValue)
  if (!rb.found) return failed('selector_missing')
  if (!rb.sameNode) return failed('portal_mutation', true)
  // VERIFY (readback-engine — normalize + hash + compare)
  const v = await verifyField(rb.value, cmd.expectedValueHash)
  // The hash goes back only on a match, where it equals the expected hash the
  // server already holds. On a mismatch it would be an unsalted SHA-256 of what
  // is in the page — recoverable by guessing for a date or a country.
  if (v.outcome !== 'verified') return { ...base, outcome: v.outcome, reason: v.reason, selectorFound: true }
  return { ...base, outcome: v.outcome, actualValueHash: v.actualValueHash, selectorFound: true }
}

/**
 * A dialog step has no control value to read: its readback is the state it
 * produced (the dialog is open / the row was added), which stands for the
 * reviewed row summary. Still hashed and compared, so the server's own check
 * of the hash applies to it like to any field.
 */
async function verified(
  base: Pick<PortalFillFieldResult, 'protocol' | 'kind' | 'executionId' | 'fieldKey'>,
  mappedValue: string,
  expectedValueHash: string,
): Promise<PortalFillFieldResult> {
  const v = await verifyField(mappedValue, expectedValueHash)
  if (v.outcome !== 'verified') return { ...base, outcome: 'failed', reason: v.reason, selectorFound: true }
  return { ...base, outcome: 'verified', actualValueHash: v.actualValueHash, selectorFound: true }
}

/** Would the step for this op accept this element? (Same rule as the step.) */
function presentFor(el: Element, op: PortalFillOp | null | undefined): boolean {
  if (op === 'radio') return isSafeChoiceTarget(el, 'radio')
  if (op === 'check') return isSafeChoiceTarget(el, 'checkbox')
  if (op === 'dialog_open') return isSafeAddButton(el, inDialog(el))
  return isSafeWriteTarget(el)
}

function readbackFields(selectors: string[], ops?: Array<PortalFillOp | null>): ReadbackResult[] {
  return selectors.map((selector, i): ReadbackResult => {
    const op = ops?.[i] ?? null
    // A dialog's Save button is not on the page until the dialog opens.
    if (op === 'dialog_save' || selector === DIALOG_SAVE) return { selector, value: '', found: false }
    const target = resolveTarget(selector)
    // Ambiguous is reported as NOT found — the server refuses a run with any
    // missing selector, which is the right answer for one that names two fields.
    if (target.status === 'ambiguous') return { selector, value: '', found: false, ambiguous: true }
    if (target.status !== 'found') return { selector, value: '', found: false }
    // The probe applies the step's rule: a field the writer would refuse
    // (hidden, disabled, read-only, not a data input) — or a radio, checkbox
    // or add button the actuator would refuse — is reported missing, so the
    // all-or-nothing check stops the run before anything is entered instead
    // of the run stopping part-way at that field.
    if (!presentFor(target.el, op)) return { selector, value: '', found: false }
    if (op) return { selector, value: '', found: true }
    const el = target.el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    // Read only — never assigns.
    return { selector, value: el.value ?? '', found: true }
  })
}
