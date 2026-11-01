import type { ExtMessage, PortalFillFieldResult, PortalFillOp, PortalFillWriteCommand, ReadbackResult } from './shared'
import { isPortalFillProtocolCompatible, PORTAL_FILL_PROTOCOL_VERSION } from './shared'
import { dryRunField } from './portal-fill-executor'
import { executeSelectByText, executeSelectByTextWhenListed, executeWrite, keepAllowsWrite, type WriteOutcome } from './executor/field-executor'
import { readField } from './executor/readback'
import { verifyField } from './readback-engine'
import { rowSummaryPresent } from './executor/row-match'
import { watchSessionWarning } from './session-warning'
import {
  checkFile,
  fileTaken,
  findUploadInput,
  inputAccepts,
  isUploadSelector,
  onPrCasePage,
  prAttachmentShows,
  prAttachmentState,
  requiredUploads,
  setFile,
  slotHasFile,
} from './executor/file-attach'
import { cardIsDependant, dependantCardVerdict, parseReviewedDependant, readDependantCards } from './executor/dependant-match'
import {
  dependantForm,
  dependantFormHasValues,
  inDialog,
  pageRowTexts,
  pageRowTotal,
  questionText,
  resolveTarget,
  parseScopedSelector,
  rowIndexOf,
  rowSelector,
  scopesHold,
  screenText,
  topDialog,
  waitForTarget,
  waitUntil,
} from './executor/resolve-target'
import {
  isSafeAddButton,
  isSafeChoiceTarget,
  isSafeDependantSave,
  isSafeWriteTarget,
  isSelectAwaitingOptions,
} from './executor/safety-guards'
import {
  addInlineRow,
  allPageRowTexts,
  chooseRadio,
  findInlineAddButton,
  DEPENDANT_ADD,
  DEPENDANT_SAVE,
  DIALOG_SAVE,
  ensureChecked,
  findDependantAddButton,
  findDependantSave,
  findDialogSave,
  openDependantForm,
  openRowDialog,
  saveDependantForm,
  saveRowDialog,
  pressSaveAndContinue,
  type ActOutcome,
} from './executor/control-actuator'
import { advanceCheck, pageStillClean } from './executor/advance-check'

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
 *  - PR profile dependants: `dependant_open` clicks the one guarded "Add
 *    dependant" (unless the dependant's card is already saved, or refused
 *    when a dependant form is open with values), the form's fields resolve
 *    only inside that inline form (`>> dependant`: its date of birth reuses
 *    the principal's id), and `dependant_save` clicks its enabled "Save
 *    details". Edit, Delete, Cancel and "Save and continue" are never clicked.
 *  - The one exception for files: `attach_file` puts a reviewed document the
 *    SERVER sent (bytes, never a URL; hashed and size/type checked) on an
 *    IRCC /doc-upload (or PR portal application page) file input found by
 *    its slot's visible row text, and only into an empty slot
 *    (`executor/file-attach.ts`). It never removes a file.
 *  - A step that only appears after an earlier one (a follow-up question, a
 *    field in a dialog) is waited for, briefly, and fails as missing if it
 *    never appears.
 *  - `readback` and `field-readback` are read-only.
 *  - It never navigates or submits. Payment, signature and final
 *    submission have no code path here. The one exception is the
 *    applicant's opt-in auto-advance (`advance-press`): "Save and continue"
 *    on an allow-listed IRCC Portal (tr-rt) form page, once per page, after
 *    a read-only check — never on /summary or anything after it.
 *  - Intents arrive only from the background service worker, only for the tab
 *    bound to the session, and only after the server has authorized the
 *    execution.
 *
 * The legacy 'execute-step' message is retained only to return an explicit
 * deprecation result to any stale caller — it performs no mutation.
 */
// The background worker re-injects this script into a portal tab whose copy
// went away (extension reloaded or updated while the tab was open). Only one
// copy may ever listen, or one intent would be written twice.
const LOADED_FLAG = '__visaaiPortalAssistantLoaded'
const alreadyLoaded = (globalThis as Record<string, unknown>)[LOADED_FLAG] === true
;(globalThis as Record<string, unknown>)[LOADED_FLAG] = true

if (!alreadyLoaded) chrome.runtime.onMessage.addListener((msg: ExtMessage, sender, sendResponse) => {
  // Only this extension's own worker. Page script has no chrome.runtime, so
  // this is defence in depth, not the boundary.
  if (sender.id !== chrome.runtime.id) return false

  // READ-ONLY readback (the bridge's pre-flight probe).
  if (msg.type === 'readback') {
    sendResponse(readbackFields(msg.selectors, msg.ops, msg.awaitOptions))
    return true
  }

  // READ-ONLY: the questions this screen asks (label text of its visible
  // controls), for the side panel's "already filled this screen" check.
  if (msg.type === 'screen-questions') {
    sendResponse(screenSignature())
    return true
  }

  // READ-ONLY: the page's table rows, for the side panel's stale-row notice.
  if (msg.type === 'page-rows') {
    sendResponse(pageRowTexts())
    return true
  }

  // READ-ONLY: required document slots on the upload page and their status.
  if (msg.type === 'upload-status') {
    sendResponse(requiredUploads())
    return true
  }

  // AUTO-ADVANCE, READ-ONLY: is the page settled and clean enough to save?
  if (msg.type === 'advance-check') {
    void advanceCheck()
      .then(sendResponse)
      .catch(() => sendResponse(null))
    return true
  }

  // AUTO-ADVANCE: press "Save and continue" once — only on the page the side
  // panel checked, only if it is still clean, only through the actuator's
  // guarded pressSaveAndContinue (tr-rt allow-listed form pages, never
  // /summary or later).
  if (msg.type === 'advance-press') {
    if (typeof msg.path !== 'string' || location.pathname !== msg.path) {
      sendResponse({ pressed: false, reason: 'the page changed' })
      return true
    }
    const dirty = pageStillClean(typeof msg.rows === 'number' ? msg.rows : -1)
    if (dirty) {
      sendResponse({ pressed: false, reason: dirty })
      return true
    }
    const r = pressSaveAndContinue()
    sendResponse(r.done ? { pressed: true } : { pressed: false, reason: r.reason })
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

/** How long the PR portal may take to list an uploaded file (inside the server's 60 s attach timeout). */
const PR_UPLOAD_MS = 30000

/**
 * How long a select may take to list its options after an earlier answer
 * (IRCC eTA job title: 1–5 s after the occupation group, live 2026-10-18).
 * Inside the server's 15 s per-field timeout.
 */
const OPTIONS_MS = 8000

/**
 * A row the page already shows is not added again. The assistant follows the
 * applicant through the portal and a page can be filled more than once (going
 * back, an earlier run); adding the same residence, child or parent twice
 * left IRCC with duplicate rows and "You must select 1 address where you
 * currently live" (dry run 2026-10-16). The reviewed row summary
 * ("Pakistan — Citizen since 1961-06-15") is matched against the page's rows
 * word by word; when one holds every word, the row's dialog steps are not run.
 */
let rowAlreadyPresent = false

/**
 * The same for a PR profile dependant: a card showing exactly it (name, date
 * of birth, relationship, accompanying) is already under "Saved dependants", so its form steps up to and including
 * "Save details" are not run — the dependant is never added twice.
 */
let dependantAlreadyPresent = false


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

  // Attach a reviewed document (IRCC /doc-upload, PR case page). Its own rules: file input
  // only, on the upload page only, bytes from the server, slot by row text
  // (executor/file-attach.ts).
  if (cmd.op === 'attach_file') {
    rowAlreadyPresent = false
    const t = findUploadInput(cmd.selector)
    if (t.status === 'ambiguous') return failed('unsafe_target')
    if (t.status !== 'found') return failed('selector_missing')
    // PR case page (review B1): only into a row whose attachment cell is
    // there AND empty — an unseen "uploaded" look must never read as empty —
    // and done only when that cell shows the file's name.
    if (onPrCasePage()) {
      if (prAttachmentState(t.row) !== 'empty' || (t.input.files?.length ?? 0) > 0) return failed('unsafe_target', true)
      const checked = await checkFile(cmd.file)
      if (!checked.ok) return failed('controlled_rejected', true)
      // The slot's own accepted formats (PDF forms: PDF only).
      if (!inputAccepts(t.input, cmd.file!)) return failed('controlled_rejected', true)
      if (!setFile(t.input, cmd.file!, checked.bytes)) return failed('unsafe_target', true)
      if (!(await waitUntil(() => prAttachmentShows(t.row, cmd.file!.name), PR_UPLOAD_MS)))
        return failed('controlled_rejected', true)
      return verified(base, cmd.mappedValue, cmd.expectedValueHash)
    }
    // Never replace or remove a file already in the slot.
    if (slotHasFile(t.input, t.row)) return verified(base, cmd.mappedValue, cmd.expectedValueHash)
    const checked = await checkFile(cmd.file)
    if (!checked.ok) return failed('controlled_rejected', true)
    if (!setFile(t.input, cmd.file!, checked.bytes)) return failed('unsafe_target', true)
    const took = await waitUntil(() => fileTaken(t.input, t.row, cmd.file!), APPEAR_MS)
    if (!took) return failed('controlled_rejected', true)
    return verified(base, cmd.mappedValue, cmd.expectedValueHash)
  }

  if (cmd.op === 'row_add') {
    rowAlreadyPresent = false
    dependantAlreadyPresent = false
    return addRow(cmd, base, failed)
  }

  // PR profile dependants: "Add dependant", its inline form, "Save details".
  if (cmd.op === 'dependant_open') {
    rowAlreadyPresent = false
    dependantAlreadyPresent = false
    return openDependant(cmd, base, failed)
  }
  if (dependantAlreadyPresent && (cmd.op === 'dependant_save' || parseScopedSelector(cmd.selector)?.dependant)) {
    // The dependant's card is there already; its form was never opened.
    if (cmd.op === 'dependant_save') dependantAlreadyPresent = false
    return verified(base, cmd.mappedValue, cmd.expectedValueHash)
  }
  dependantAlreadyPresent = false
  if (cmd.op === 'dependant_save') {
    rowAlreadyPresent = false
    return saveDependant(cmd, base, failed)
  }

  if (rowAlreadyPresent && (cmd.dialog || cmd.op === 'dialog_save')) {
    // The row is on the page already; its dialog was never opened.
    if (cmd.op === 'dialog_save') rowAlreadyPresent = false
    return verified(base, cmd.mappedValue, cmd.expectedValueHash)
  }
  rowAlreadyPresent = false

  // A dialog field lives in the open dialog and is looked up there only.
  const scope = (): ParentNode | null => (cmd.dialog ? topDialog() : document)
  const root = scope()
  if (!root) return failed('selector_missing')

  let readMode: 'value' | 'option' | 'checked' = 'value'
  let node: Element | undefined

  if (cmd.op === 'dialog_save') {
    const found = findDialogSave(cmd.selector)
    if (!found.done) return failed(found.reason)
    // The total counts rows on other pages of a paginated grid too (IRCC
    // travel history: 3 a page), where a new row may land out of sight.
    const before = pageRowTotal()
    const beforeRows = pageRowTexts()
    const summaryBefore = rowSummaryPresent(cmd.mappedValue, beforeRows)
    const saved = saveRowDialog(found.node)
    if (!saved.done) return failed(saved.reason, true)
    // Saved = the dialog closed and the table behind it took the row. A
    // dialog that stays open is IRCC refusing the row (a required field).
    // "Took the row" is not only "one more row": an empty IRCC grid shows a
    // "no records" placeholder row that the first saved row REPLACES, so the
    // count stays the same (live 2026-10-19: parent 1 was added, its Save was
    // reported refused and the run stopped before parent 2).
    const rowAdded = () => {
      if (pageRowTotal() > before) return true
      const after = pageRowTexts()
      if (!summaryBefore && rowSummaryPresent(cmd.mappedValue, after)) return true
      return after.some((t) => t.trim() !== '' && !beforeRows.includes(t))
    }
    const ok = await waitUntil(() => !topDialog() && rowAdded(), APPEAR_MS)
    if (!ok) return failed('controlled_rejected', true)
    return verified(base, cmd.mappedValue, cmd.expectedValueHash)
  }

  // Locate. A revealed or dialog target is waited for; anything else must be
  // there now (the probe already said it was).
  // A revealed VALUE box is waited for until it can take the value (enabled,
  // visible, a data input), not merely until it exists: IRCC renders some
  // follow-ups disabled and enables them a moment later.
  const valueWrite = !cmd.op || cmd.op === 'select_text'
  const writable = (el: Element) =>
    isSafeWriteTarget(el) || (cmd.awaitOptions === true && cmd.op === 'select_text' && isSelectAwaitingOptions(el))
  const target =
    cmd.reveal || cmd.dialog || cmd.op === 'dialog_open'
      ? await waitForTarget(cmd.selector, scope, APPEAR_MS, 100, valueWrite ? writable : undefined)
      : resolveTarget(cmd.selector, root)
  if (target.status === 'ambiguous') return failed('unsafe_target')
  if (target.status !== 'found') return failed('selector_missing')
  const here = scope() ?? document

  if (cmd.op === 'dialog_open') {
    // Every page of a paginated grid: a row on page 2 is still there. A grid
    // whose pages cannot all be read safely fails the step rather than risk
    // adding a row twice.
    let present = false
    if (!topDialog()) {
      present = rowSummaryPresent(cmd.mappedValue, pageRowTexts())
      if (!present) {
        try {
          present = rowSummaryPresent(cmd.mappedValue, await allPageRowTexts())
        } catch {
          return failed('unsafe_target')
        }
      }
    }
    if (present) {
      rowAlreadyPresent = true
      return verified(base, cmd.mappedValue, cmd.expectedValueHash)
    }
    // Right after the previous row's Save, IRCC re-renders the grid: the add
    // button can be briefly disabled or replaced. A disabled one is waited
    // for (re-resolved each time) rather than failing the next row; any other
    // refusal (not an add button, page-leaving) fails at once below.
    let addButton = target.el
    if (!isSafeAddButton(addButton, inDialog(addButton)) && (addButton as HTMLButtonElement).disabled) {
      await waitUntil(() => {
        const r = resolveTarget(cmd.selector)
        if (r.status !== 'found' || !isSafeAddButton(r.el, inDialog(r.el))) return false
        addButton = r.el
        return true
      }, APPEAR_MS)
    }
    const opened = openRowDialog(addButton)
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
    // A row box that already holds a different value (the applicant's own
    // row, an earlier answer) is not overwritten: the run stops there.
    if (parseScopedSelector(cmd.selector)?.keep && !cmd.op) {
      const el = target.el as HTMLInputElement | HTMLTextAreaElement
      if (!keepAllowsWrite(el.value ?? '', cmd.mappedValue)) return failed('value_mismatch', true)
    }
    const w: WriteOutcome =
      cmd.op === 'select_text'
        ? // Only a select the mapping marks as loading late waits for its
          // option (eTA job title); every other select answers at once.
          cmd.awaitOptions
          ? await executeSelectByTextWhenListed(cmd.selector, cmd.mappedValue, here, OPTIONS_MS, 100, () =>
              Boolean(chrome.runtime?.id),
            )
          : executeSelectByText(cmd.selector, cmd.mappedValue, here)
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

/**
 * An inline row (IRCC PR portal, `row_add`): the row `cmd.selector` names
 * must exist. There already (a re-run, the applicant added it): nothing is
 * clicked. Otherwise, only when the selector's scopes hold (its section's
 * screen, the principal applicant's own form) and the row BEFORE it is there,
 * the page's one guarded "Add another" is clicked once and the row must
 * appear. Rows are added one at a time in order, never more than the
 * reviewed data has, and never removed.
 */
async function addRow(
  cmd: PortalFillWriteCommand,
  base: Pick<PortalFillFieldResult, 'protocol' | 'kind' | 'executionId' | 'fieldKey'>,
  failed: (reason: PortalFillFieldResult['reason'], selectorFound?: boolean) => PortalFillFieldResult,
): Promise<PortalFillFieldResult> {
  // More rows on the page than the reviewed data: someone else's rows. The
  // section is refused, never mixed.
  if (tooManyRows(cmd.selector)) return failed('unsafe_target', true)
  const here = resolveTarget(cmd.selector)
  if (here.status === 'found') return verified(base, cmd.mappedValue, cmd.expectedValueHash)
  if (here.status === 'ambiguous' || here.status === 'invalid') return failed('unsafe_target')
  const add = rowAddable(cmd.selector)
  if (!add.done) return failed(add.reason)
  const clicked = addInlineRow(add.node)
  if (!clicked.done) return failed(clicked.reason, true)
  const appeared = await waitUntil(() => resolveTarget(cmd.selector).status === 'found', APPEAR_MS)
  if (!appeared) return failed('dom_change', true)
  return verified(base, cmd.mappedValue, cmd.expectedValueHash)
}

/** How long IRCC may take to enable "Save details" after the last field. */
const SAVE_ENABLE_MS = 2000

/**
 * One PR profile dependant, opened (op dependant_open). A card that is
 * exactly this dependant: nothing is clicked and its form steps are skipped. A dependant form
 * already open: used when empty, refused when it holds anything (someone's
 * half-entered dependant is never mixed with this one). Otherwise the
 * profile's ONE guarded "Add dependant" is clicked and its form must appear.
 */
async function openDependant(
  cmd: PortalFillWriteCommand,
  base: Pick<PortalFillFieldResult, 'protocol' | 'kind' | 'executionId' | 'fieldKey'>,
  failed: (reason: PortalFillFieldResult['reason'], selectorFound?: boolean) => PortalFillFieldResult,
): Promise<PortalFillFieldResult> {
  if (cmd.selector !== DEPENDANT_ADD) return failed('unsafe_target')
  const reviewed = parseReviewedDependant(cmd.mappedValue)
  if (!reviewed) return failed('unsafe_target')
  // Saved cards, field by field (never word overlap: "Ali Khan" is not "Ali
  // Reza Khan"). Exactly this dependant: skip it. Same name and date of birth
  // but another relationship / accompanying answer: stop — its steps are not
  // claimed done. Same family name and date of birth under another name (a
  // twin, a different spelling): stop before any click.
  const verdict = dependantCardVerdict(readDependantCards(), reviewed)
  if (verdict === 'present') {
    dependantAlreadyPresent = true
    return verified(base, cmd.mappedValue, cmd.expectedValueHash)
  }
  if (verdict === 'differs') return failed('value_mismatch', true)
  if (verdict === 'conflict') return failed('unsafe_target', true)
  const open = dependantForm()
  if (open) {
    if (dependantFormHasValues(open)) return failed('unsafe_target', true)
    return verified(base, cmd.mappedValue, cmd.expectedValueHash)
  }
  // A dependant form is there but is not the one form (two of them, or it
  // cannot be told from the principal's fields): nothing is clicked.
  if (document.querySelector('#dependantForm-relationship')) return failed('unsafe_target', true)
  // Right after a previous "Save details" IRCC re-renders the section: the
  // button may take a moment to come back.
  let add = findDependantAddButton()
  if (!add.done && add.reason === 'selector_missing')
    await waitUntil(() => {
      add = findDependantAddButton()
      return add.done || add.reason !== 'selector_missing'
    }, APPEAR_MS)
  if (!add.done) return failed(add.reason)
  const clicked = openDependantForm(add.node)
  if (!clicked.done) return failed(clicked.reason, true)
  if (!(await waitUntil(() => dependantForm() !== null, APPEAR_MS))) return failed('dom_change', true)
  return verified(base, cmd.mappedValue, cmd.expectedValueHash)
}

/**
 * "Save details" of the open dependant form (op dependant_save), only once
 * IRCC enables it; a button that stays disabled (IRCC finds the form
 * incomplete) is never clicked. Saved = the form closed and a card shows
 * exactly this dependant (name, date of birth, relationship, accompanying).
 */
async function saveDependant(
  cmd: PortalFillWriteCommand,
  base: Pick<PortalFillFieldResult, 'protocol' | 'kind' | 'executionId' | 'fieldKey'>,
  failed: (reason: PortalFillFieldResult['reason'], selectorFound?: boolean) => PortalFillFieldResult,
): Promise<PortalFillFieldResult> {
  if (cmd.selector !== DEPENDANT_SAVE) return failed('unsafe_target')
  const reviewed = parseReviewedDependant(cmd.mappedValue)
  if (!reviewed) return failed('unsafe_target')
  const found = findDependantSave()
  if (!found.done) return failed(found.reason)
  const button = found.node as HTMLButtonElement
  if (button.disabled)
    await waitUntil(() => {
      const form = dependantForm()
      return !!form && isSafeDependantSave(button, form)
    }, SAVE_ENABLE_MS)
  if (button.disabled) return failed('controlled_rejected', true)
  const saved = saveDependantForm(button)
  if (!saved.done) return failed(saved.reason, true)
  const ok = await waitUntil(
    () => dependantForm() === null && readDependantCards().some((c) => cardIsDependant(c, reviewed)),
    APPEAR_MS,
  )
  if (!ok) return failed('controlled_rejected', true)
  return verified(base, cmd.mappedValue, cmd.expectedValueHash)
}

/** The page already holds more of this section's rows than `>> rows=N` allows. */
function tooManyRows(selector: string): boolean {
  const max = parseScopedSelector(selector)?.rows
  if (max === undefined) return false
  const extra = rowSelector(selector, max)
  return !!extra && resolveTarget(extra).status === 'found'
}

/** The button that would add this row now, or why it may not be added. */
function rowAddable(selector: string): ActOutcome {
  const row = rowIndexOf(selector)
  if (row === null || row < 1) return { done: false, reason: 'unsafe_target' }
  if (!scopesHold(selector)) return { done: false, reason: 'selector_missing' }
  // One row at a time: the row before must be on the page, or a click would
  // add that one instead.
  const previous = rowSelector(selector, row - 1)
  if (!previous || resolveTarget(previous).status !== 'found') return { done: false, reason: 'selector_missing' }
  // …and the row after it must not be: then the page's rows are not in order.
  const after = rowSelector(selector, row + 1)
  if (!after || resolveTarget(after).status !== 'missing') return { done: false, reason: 'unsafe_target' }
  return findInlineAddButton()
}

/** Would the step for this op accept this element? (Same rule as the step.) */
function presentFor(el: Element, op: PortalFillOp | null | undefined, awaitOptions = false): boolean {
  // A select disabled while its list loads is there: its write waits (eTA job title).
  if (awaitOptions && op === 'select_text' && isSelectAwaitingOptions(el)) return true
  if (op === 'radio') return isSafeChoiceTarget(el, 'radio')
  if (op === 'check') return isSafeChoiceTarget(el, 'checkbox')
  if (op === 'dialog_open') return isSafeAddButton(el, inDialog(el))
  return isSafeWriteTarget(el)
}

function readbackFields(
  selectors: string[],
  ops?: Array<PortalFillOp | null>,
  awaitOptions?: boolean[],
): ReadbackResult[] {
  return selectors.map((selector, i): ReadbackResult => {
    const op = ops?.[i] ?? null
    // A dialog's Save button is not on the page until the dialog opens.
    if (op === 'dialog_save' || selector === DIALOG_SAVE) return { selector, value: '', found: false }
    // Nor is a dependant form's "Save details"; "Add dependant" is there when
    // its one guarded button is (or a dependant form is open already).
    if (op === 'dependant_save' || selector === DEPENDANT_SAVE) return { selector, value: '', found: false }
    if (op === 'dependant_open')
      return { selector, value: '', found: findDependantAddButton().done || dependantForm() !== null }
    // An upload slot: present when exactly one file input on the upload page
    // has a row naming it. Read only.
    if (op === 'attach_file' || isUploadSelector(selector)) {
      const t = findUploadInput(selector)
      return t.status === 'ambiguous'
        ? { selector, value: '', found: false, ambiguous: true }
        : { selector, value: '', found: t.status === 'found' }
    }
    // An inline row: present when it is there, or when it can be added now.
    if (op === 'row_add') {
      const t = resolveTarget(selector)
      if (t.status === 'ambiguous') return { selector, value: '', found: false, ambiguous: true }
      return { selector, value: '', found: t.status === 'found' || rowAddable(selector).done }
    }
    const target = resolveTarget(selector)
    // Ambiguous is reported as NOT found — the server refuses a run with any
    // missing selector, which is the right answer for one that names two fields.
    if (target.status === 'ambiguous') return { selector, value: '', found: false, ambiguous: true }
    // There, but its list lacks the reviewed answer: said up front, so the
    // server refuses the screen before anything on it is written.
    if (target.status === 'no_option') return { selector, value: '', found: false, optionMissing: true }
    if (target.status !== 'found') return { selector, value: '', found: false }
    // The probe applies the step's rule: a field the writer would refuse
    // (hidden, disabled, read-only, not a data input) — or a radio, checkbox
    // or add button the actuator would refuse — is reported missing, so the
    // all-or-nothing check stops the run before anything is entered instead
    // of the run stopping part-way at that field.
    if (!presentFor(target.el, op, awaitOptions?.[i] === true)) return { selector, value: '', found: false }
    if (op) return { selector, value: '', found: true }
    const el = target.el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    // Read only — never assigns.
    return { selector, value: el.value ?? '', found: true }
  })
}

/**
 * What identifies a questionnaire screen, for the side panel's "already
 * filled this screen" check. READ-ONLY. Two lines of each:
 *  - the label of every visible form control, once each, in order;
 *  - the control ids (`answerlist[0]`…) — which of IRCC's controls are there;
 *  - a hash of the visible text (screenText: no option text, no .wb-inv),
 *    leaving out error and alert boxes, so two Yes / No screens whose labels
 *    are generic ("Yes", "No") but whose question paragraphs differ never
 *    look alike, while the same screen shown again with a validation error
 *    still does.
 * The text itself never leaves the page: only its hash.
 */
function screenSignature(): string[] {
  const labels: string[] = []
  const ids: string[] = []
  for (const el of Array.from(document.querySelectorAll('select, input, textarea'))) {
    const type = ((el as HTMLInputElement).type || '').toLowerCase()
    if (['hidden', 'submit', 'button', 'image', 'reset'].includes(type)) continue
    const q = questionText(el)
    if (q && !labels.includes(q)) labels.push(q)
    const id = el.getAttribute('name') ?? el.id
    if (id && !ids.includes(id)) ids.push(id)
  }
  if (labels.length === 0 && ids.length === 0) return []
  return [...labels, `controls:${ids.join(',')}`, `text:${textHash(signatureText())}`]
}

/** Error / alert boxes come and go on the same screen; they are not the screen. */
const TRANSIENT = '[role="alert"], .alert, .label-danger, [class*="error"]'

function signatureText(): string {
  const gone = Array.from(document.querySelectorAll(TRANSIENT)).map((e) => e.textContent ?? '')
  let t = screenText()
  for (const g of gone) {
    const s = g.replace(/\s+/g, ' ').trim()
    if (s) t = t.split(s).join(' ')
  }
  return t.replace(/\s+/g, ' ').trim()
}

/** FNV-1a, 32-bit, hex: a short stable fingerprint (not a security hash). */
function textHash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

// IRCC's session timeout warning → the side panel (read-only; see
// session-warning.ts). Only the first copy of this script watches.
if (!alreadyLoaded && document.body && chrome.runtime?.id)
  watchSessionWarning((shown) => {
    void chrome.runtime
      ?.sendMessage({ type: 'portal-session-warning', shown } satisfies ExtMessage)
      ?.catch(() => {
        /* no panel open — nothing to tell */
      })
  })
