export type FillAction = 'fill' | 'select' | 'check' | 'click' | 'pause' | 'info' | 'upload'

export interface FillInstruction {
  stepId: string
  action: FillAction
  selector: string
  value: string
  label: string
  downloadUrl?: string
  fileName?: string
}

export type ExtMessage =
  | { type: 'connect'; apiUrl: string; token: string }
  | { type: 'plan'; totalSteps: number; instructions: FillInstruction[] }
  | { type: 'execute-step'; instruction: FillInstruction }
  | { type: 'step-result'; stepId: string; ok: boolean; detail?: string }
  | { type: 'status'; status: 'connected' | 'active' | 'paused' | 'complete' | 'error'; detail?: string }
  // READ-ONLY readback. Reads current portal field values for the given
  // selectors; the bridge's pre-flight probe forwards presence only. Never
  // writes, clicks, or navigates.
  // `ops` (parallel to selectors, protocol 2) names the rule each target must
  // pass: a radio input or an "add" button is present, not a data field.
  | { type: 'readback'; selectors: string[]; ops?: Array<PortalFillOp | null>; awaitOptions?: boolean[] }
  // Phase 7E — portal-fill executor SCAFFOLD (read-only dry run). Resolves +
  // reads back + compares the field's CURRENT value to the expected hash.
  // It does NOT write, mutate, submit, or navigate.
  | { type: 'portal-fill-dry'; command: PortalFillWriteCommand }
  // Phase 7H — execute one signed field intent: write (executor) → readback →
  // verify → result. The ONLY write path in the system. Never submits/navigates.
  | { type: 'execute-field-intent'; command: PortalFillWriteCommand }
  // Phase 7H — read-only readback request (no write).
  | { type: 'field-readback'; selector: string }
  // Phase 7I — transport bridge (background-side). Session binding + tab-scoped
  // dispatch to the bound tab's content script. Fail-closed; no live server leg.
  | { type: 'pf-bind-session'; executionId: string; tabId: number }
  | { type: 'pf-execute-field'; command: PortalFillWriteCommand }
  | { type: 'pf-unbind-session' }
  // Phase 7K — read-only pre-flight. Asks the BOUND tab which selectors resolve,
  // before any write. Returns presence booleans only; never values.
  | { type: 'pf-probe'; selectors: string[]; ops?: Array<PortalFillOp | null>; awaitOptions?: boolean[] }
  // READ-ONLY: the text of the data rows in the bound tab's tables (side panel
  // → background → content), for the stale-row notice. Never leaves the browser.
  | { type: 'pf-page-rows' }
  | { type: 'page-rows' }
  // READ-ONLY: the questions on the screen (their label text), so a server-
  // paged form's screen already filled is not filled again.
  | { type: 'screen-questions' }
  // READ-ONLY: the required document slots on IRCC /doc-upload and whether each
  // shows a file, so the panel can say what still blocks payment.
  | { type: 'pf-upload-status' }
  | { type: 'upload-status' }
  | { type: 'portal-session-warning'; shown: boolean }
  // AUTO-ADVANCE (opt-in, IRCC Portal tr-rt only). advance-check is READ-ONLY:
  // it waits for the page's rows to hold still and reports errors, empty
  // required questions, an open dialog or the session warning. advance-press
  // presses "Save and continue" (#next_path) once, only through
  // control-actuator's guarded pressSaveAndContinue, only on `path`.
  | { type: 'advance-check' }
  | { type: 'advance-press'; path: string; rows: number }

/** Current value of one portal field, read read-only from the live DOM. */
export interface ReadbackResult {
  selector: string
  value: string
  found: boolean
  /** The selector matched more than one element; reported as not found. */
  ambiguous?: boolean
  /** The control is there, but its <select> does not list the scoped option. */
  optionMissing?: boolean
}

/**
 * How long a web-app handoff (`pendingSession` in chrome.storage.local) stays
 * usable. It carries a readbackToken holding the applicant's mapped values, so
 * past this it is not just ignored but PURGED — by the reader, by the worker's
 * alarm, and whenever the worker starts.
 */
export const PENDING_SESSION_TTL_MS = 5 * 60 * 1000

// ── Portal-fill protocol (mirror of @visaai/types — drift guarded at runtime by
//    the version handshake; extension stays dependency-free per existing pattern) ──
// 2: write commands carry op / reveal / dialog; probes carry ops and report the
// bound tab's page path. A version-1 peer is refused, not tolerated.
export const PORTAL_FILL_PROTOCOL_VERSION = 2

/** Non-value operations (mirror of @visaai/types PortalFillOp). */
export type PortalFillOp =
  | 'radio'
  | 'check'
  | 'select_text'
  | 'dialog_open'
  | 'dialog_save'
  | 'attach_file'
  | 'row_add'
  | 'dependant_open'
  | 'dependant_save'

export type PortalFillFieldOutcome = 'verified' | 'failed'
export type PortalFillFailReason =
  | 'selector_missing'
  | 'value_mismatch'
  | 'portal_mutation'
  | 'controlled_rejected'
  | 'dom_change'
  | 'unsafe_target'
  | 'timeout'
  | 'transport_error'
  | 'replay'

export interface PortalFillWriteCommand {
  protocol: number
  kind: 'write'
  executionId: string
  fieldKey: string
  selector: string
  mappedValue: string
  expectedValueHash: string
  /** How the target is operated; absent = a value write. */
  op?: PortalFillOp
  /** Appears only after an earlier step on the page: wait for it. */
  reveal?: boolean
  /** Lives inside the open "add row" dialog: resolve it there. */
  dialog?: boolean
  /** A <select> whose options load after an earlier answer: wait for the option (eTA job title). */
  awaitOptions?: boolean
  /** What the panel shows for this step ("Passport number"). Display only. */
  label?: string
  /** op 'attach_file': the document's bytes, from the server (never a URL). */
  file?: PortalFillFile
}

/** Mirror of @visaai/types PortalFillFile. */
export interface PortalFillFile {
  name: string
  mimeType: string
  size: number
  sha256: string
  base64: string
}

export interface PortalFillFieldResult {
  protocol: number
  kind: 'field_result'
  executionId: string
  fieldKey: string
  outcome: PortalFillFieldOutcome
  reason?: PortalFillFailReason
  actualValueHash?: string
  selectorFound: boolean
}

/** server ↔ background: lifecycle stage signal. Mirrors @visaai/types. */
export interface PortalFillStageMessage {
  protocol: number
  kind: 'stage'
  executionId: string
  stage: 'started' | 'completed' | 'failed'
  reason?: PortalFillFailReason
  failedFieldKey?: string
  filledPages?: string[]
  nextPage?: { page: string; title: string } | null
  failedLabel?: string
  /** Progressive page (eTA): reviewed answers whose questions are not shown yet. */
  remaining?: string[]
  /** On completed: what the assistant leaves for the applicant on the page it filled (labels). */
  left?: string[]
}

export function isPortalFillProtocolCompatible(protocol: number): boolean {
  return protocol === PORTAL_FILL_PROTOCOL_VERSION
}

/**
 * Servers this extension will hand a session to, or take instructions from.
 *
 * SEC-8510. A token bound to an attacker's server means the next call
 * exfiltrates the user's session, and the write path means values the attacker
 * chose get typed into the user's authenticated government form. TWO paths dial
 * a server — the web-app handoff in `background.ts` and the manual box in the
 * side panel — and the rule must be the same on both, so it lives here in one
 * copy rather than in whichever file remembered it.
 *
 * `endsWith('.visaai.co')` rather than `includes`: `visaai.co.evil.test` must
 * not pass. HTTPS is required for the real host; localhost is allowed on plain
 * http for development, and the production build strips localhost from
 * `externally_connectable` (build.mjs) so it cannot be reached that way.
 */
export function isTrustedApiUrl(apiUrl: string): boolean {
  try {
    const u = new URL(apiUrl)
    const host = u.hostname
    if (u.protocol === 'https:' && (host === 'visaai.co' || host.endsWith('.visaai.co')))
      return true
    if ((u.protocol === 'http:' || u.protocol === 'https:') && (host === 'localhost' || host === '127.0.0.1'))
      return true
    return false
  } catch {
    return false
  }
}

/** One required document slot on IRCC /doc-upload. */
export interface RequiredUpload {
  name: string
  uploaded: boolean
}
