import { sendToPortalTab } from './portal-messaging'
import { pickPortalTabToFocus } from './portal-tab'
import type {
  ExtMessage,
  FillInstruction,
  PortalFillFailReason,
  PortalFillFieldResult,
  PortalFillOp,
  PortalFillWriteCommand,
} from './shared'
import {
  isPortalFillProtocolCompatible,
  isTrustedApiUrl,
  PENDING_SESSION_TTL_MS,
  PORTAL_FILL_PROTOCOL_VERSION,
} from './shared'

interface ExternalMessage {
  type: 'ping' | 'session' | 'open-panel'
  token?: string
  apiUrl?: string
  portalUrl?: string
  /**
   * Phase 7J — the signed readback token from POST /execution/request. It is the
   * ONLY authority for the verified fill: the server reads the field mappings
   * out of it rather than trusting anything the extension sends. Optional so an
   * older web build still hands off a review-only session.
   */
  readbackToken?: string
  /**
   * The portal pages this application's fill covers (e.g. '/doc-upload' or
   * '/eta/welcome'). Only used to pick which tab Launch brings to the front.
   */
  portalPages?: unknown
}

interface PendingSession {
  token: string
  apiUrl: string
  portalUrl?: string
  readbackToken?: string
  receivedAt: number
}

// Clicking the toolbar icon opens the side panel. A session handoff arrives
// after the page's network calls, too late to carry the Launch click's
// gesture, so it badges the icon instead; the 'open-panel' message below is
// sent at the click and opens the panel directly when Chrome allows it. Don't also
// register chrome.action.onClicked: when both are registered the auto-open
// consumes the gesture, then onClicked fires and our manual sidePanel.open()
// fails with "may only be called in response to a user gesture".
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })

// ── hand-offs already handled ────────────────────────────────────────────────
/**
 * SHA-256 of the last few session tokens stored (never the token itself), so a
 * retried hand-off of the same launch is recognised across a worker restart.
 */
const HANDLED_KEY = 'handledSessionTokens'
const HANDLED_MAX = 10

async function tokenHash(token: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** True when this token was stored before (a retried hand-off of the same launch). */
async function wasHandled(token: string): Promise<boolean> {
  const h = await tokenHash(token)
  const stored = await chrome.storage.local.get(HANDLED_KEY)
  const list = Array.isArray(stored[HANDLED_KEY]) ? (stored[HANDLED_KEY] as string[]) : []
  return list.includes(h)
}

/**
 * Record a token as stored — only AFTER pendingSession was written, so a
 * hand-off that failed part-way is retried for real instead of acknowledged
 * with nothing stored.
 */
async function markHandled(token: string): Promise<void> {
  const h = await tokenHash(token)
  const stored = await chrome.storage.local.get(HANDLED_KEY)
  const list = Array.isArray(stored[HANDLED_KEY]) ? (stored[HANDLED_KEY] as string[]) : []
  if (!list.includes(h)) await chrome.storage.local.set({ [HANDLED_KEY]: [...list, h].slice(-HANDLED_MAX) })
}

// ── pendingSession expiry ────────────────────────────────────────────────────
// The handoff carries a readbackToken holding the applicant's mapped values
// (passport number, DOB, address). Its TTL used to exist only in the side
// panel's reader, so a session the user never opened sat in
// chrome.storage.local indefinitely. It is purged three ways: an alarm at the
// TTL (a setTimeout would not survive the worker being stopped), every worker
// start (covers a missed alarm and a browser restart), and the reader.
const PENDING_PURGE_ALARM = 'purge-pending-session'

async function purgeStalePendingSession(): Promise<void> {
  const stored = await chrome.storage.local.get('pendingSession')
  const pending = stored.pendingSession as PendingSession | undefined
  if (!pending) return
  // Still fresh — a newer handoff replaced the one this alarm was set for.
  if (typeof pending.receivedAt === 'number' && Date.now() - pending.receivedAt < PENDING_SESSION_TTL_MS) return
  await chrome.storage.local.remove('pendingSession')
  await chrome.action.setBadgeText({ text: '' })
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PENDING_PURGE_ALARM) void purgeStalePendingSession().catch(() => {})
})
chrome.runtime.onStartup.addListener(() => {
  void purgeStalePendingSession().catch(() => {})
})
void purgeStalePendingSession().catch(() => {})

// SEC-8510: `externally_connectable` in the manifest is the coarse gate on WHICH
// origins may message us, but the handler must still (a) verify the sender is a
// trusted VisaAI origin and (b) refuse to accept an attacker-chosen apiUrl —
// otherwise a page on a trusted-but-compromised origin (or, when localhost is
// permitted in dev, any local process) could hand the extension a token bound
// to an attacker's server, exfiltrating the user's session on the next call.
function isTrustedSenderOrigin(origin: string | undefined): boolean {
  if (!origin) return false
  try {
    const u = new URL(origin)
    const host = u.hostname
    if (u.protocol === 'https:' && (host === 'visaai.co' || host.endsWith('.visaai.co')))
      return true
    // Dev only: localhost is present in externally_connectable for dev builds.
    if ((u.protocol === 'http:' || u.protocol === 'https:') && (host === 'localhost' || host === '127.0.0.1'))
      return true
    return false
  } catch {
    return false
  }
}

/** At most 50 paths, each starting with '/'; anything else is ignored. */
function portalPagesOf(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const pages = v.filter((p): p is string => typeof p === 'string' && p.startsWith('/') && p.length <= 200).slice(0, 50)
  return pages.length ? pages : undefined
}

// Messages from the VisaAI web app (allowed origins listed in manifest.json
// "externally_connectable"). Two message types: a presence ping the page uses
// to detect that the extension is installed, and a session handoff that stores
// the single-use token and badges the toolbar icon so the user knows to open
// the side panel.
chrome.runtime.onMessageExternal.addListener((msg: ExternalMessage, _sender, sendResponse) => {
  const senderOrigin = _sender.origin ?? (_sender.url ? new URL(_sender.url).origin : undefined)
  if (!isTrustedSenderOrigin(senderOrigin)) {
    sendResponse({ ok: false, detail: 'untrusted sender' })
    return false
  }

  // Sent by the Launch click itself, before the page's own awaits, so Chrome
  // still counts it as the applicant's click: the side panel opens with no
  // toolbar click (live 2026-10-17: "it's not loading extension
  // automatically"). Called synchronously — any await first loses the
  // gesture. If Chrome refuses, the GO badge is the fallback as before.
  if (msg.type === 'open-panel') {
    const windowId = _sender.tab?.windowId
    if (windowId == null) {
      sendResponse({ ok: false, detail: 'no window' })
      return false
    }
    chrome.sidePanel
      .open({ windowId })
      .then(() => sendResponse({ ok: true }))
      .catch((err: unknown) => {
        console.warn('[VisaAI ext] side panel did not open from Launch:', err)
        sendResponse({ ok: false, detail: err instanceof Error ? err.message : 'not opened' })
      })
    return true
  }

  if (msg.type === 'ping') {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version })
    return false
  }

  if (msg.type === 'session') {
    if (!msg.token || !msg.apiUrl) {
      sendResponse({ ok: false, detail: 'token and apiUrl required' })
      return false
    }
    if (!isTrustedApiUrl(msg.apiUrl)) {
      sendResponse({ ok: false, detail: 'untrusted apiUrl' })
      return false
    }
    const pending: PendingSession = {
      token: msg.token,
      apiUrl: msg.apiUrl,
      portalUrl: msg.portalUrl,
      readbackToken: msg.readbackToken,
      receivedAt: Date.now(),
    }
    void (async () => {
      try {
        // The web page retries a hand-off it got no answer to (a reply that
        // was slow, not lost). Storing the same single-use token again would
        // make an open panel drop its live socket and reconnect with a spent
        // token. A token already handled is acknowledged, not stored again.
        if (await wasHandled(pending.token)) {
          sendResponse({ ok: true })
          return
        }
        await chrome.storage.local.set({ pendingSession: pending })
        await markHandled(pending.token)
        // Replaces any earlier alarm of the same name.
        await chrome.alarms.create(PENDING_PURGE_ALARM, { when: pending.receivedAt + PENDING_SESSION_TTL_MS })
        // Badge prompts the user to click the toolbar icon — that click carries
        // a user gesture, which opens the side panel (via openPanelOnActionClick
        // above) and lets sidepanel.ts auto-connect from the stored session.
        await chrome.action.setBadgeBackgroundColor({ color: '#10c22b' })
        await chrome.action.setBadgeText({ text: 'GO' })
        console.log('[VisaAI ext] session stored, badge set, version', chrome.runtime.getManifest().version)
        // Switch to the portal tab in the window Launch was clicked in: the
        // panel fills only the portal tab in front.
        const windowId = _sender.tab?.windowId
        if (windowId != null) {
          const target = pickPortalTabToFocus(await chrome.tabs.query({ windowId }), portalPagesOf(msg.portalPages))
          if (target != null) await chrome.tabs.update(target, { active: true }).catch(() => undefined)
        }
        sendResponse({ ok: true })
      } catch (err) {
        console.error('[VisaAI ext] session handoff failed:', err)
        sendResponse({ ok: false, detail: err instanceof Error ? err.message : 'handoff failed' })
      }
    })()
    return true
  }

  sendResponse({ ok: false, detail: 'unknown message type' })
  return false
})

chrome.runtime.onMessage.addListener((msg: ExtMessage, sender, sendResponse) => {
  // Only this extension's own pages and content scripts. Web pages cannot
  // reach runtime.onMessage (onMessageExternal is gated separately above), so
  // this is defence in depth, not the boundary.
  if (sender.id !== chrome.runtime.id) return false

  if (msg.type === 'execute-step') {
    void executeInActiveTab(msg.instruction).then(result => sendResponse(result))
    return true
  }

  // Phase 7I — transport bridge. Bind a session to a specific tab, then dispatch
  // signed field intents ONLY to that bound tab (tab-scoped). Fail-closed. This is
  // the browser-internal leg. The server drives it from `portal-fill:start`
  // (automation.gateway.ts), and only after an all-fields-present probe of the
  // bound tab; a page missing any mapped selector gets no write at all.
  if (msg.type === 'pf-bind-session') {
    if (typeof msg.executionId !== 'string' || typeof msg.tabId !== 'number') {
      sendResponse({ ok: false, detail: 'executionId + tabId required' })
      return false
    }
    pfSession = { executionId: msg.executionId, tabId: msg.tabId }
    sendResponse({ ok: true })
    return false
  }
  if (msg.type === 'pf-unbind-session') {
    pfSession = null
    sendResponse({ ok: true })
    return false
  }
  if (msg.type === 'pf-probe') {
    void pfProbe(msg.selectors, msg.ops, msg.awaitOptions).then(sendResponse)
    return true
  }
  if (msg.type === 'pf-page-rows') {
    // Bound tab only, read-only, same tab-scoping as the probe.
    if (!pfSession) {
      sendResponse([])
      return false
    }
    void pfWithTimeout(sendToPortalTab<string[]>(pfSession.tabId, { type: 'page-rows' }), PF_TIMEOUT_MS)
      .then((rows) => sendResponse(Array.isArray(rows) ? rows : []))
      .catch(() => sendResponse([]))
    return true
  }
  if (msg.type === 'pf-upload-status') {
    // Bound tab only, read-only, like pf-page-rows.
    if (!pfSession) {
      sendResponse([])
      return false
    }
    void pfWithTimeout(sendToPortalTab<unknown[]>(pfSession.tabId, { type: 'upload-status' }), PF_TIMEOUT_MS)
      .then((rows) => sendResponse(Array.isArray(rows) ? rows : []))
      .catch(() => sendResponse([]))
    return true
  }
  if (msg.type === 'pf-execute-field') {
    void pfDispatch(msg.command).then(sendResponse)
    return true
  }
  // The side panel signals it has consumed a pending session so we clear the
  // toolbar badge. Sent fire-and-forget; no response expected.
  if ((msg as { type?: string }).type === 'session-consumed') {
    void chrome.action.setBadgeText({ text: '' })
    return false
  }
  return false
})

// ── Phase 7I transport bridge state + dispatch ──────────────────────────────
const PF_TIMEOUT_MS = 15_000
let pfSession: { executionId: string; tabId: number } | null = null

// A tab id is a container, not a page. The portal URL is checked once, at
// bind; after a navigation or reload the next write would land in whatever
// document now occupies the tab, with a content script that has never seen
// this run. Any navigation of the bound tab, or closing it, ends the session —
// the next intent then fails closed as transport_error and the run stops.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (pfSession?.tabId !== tabId) return
  if (changeInfo.url !== undefined || changeInfo.status === 'loading') pfSession = null
})
chrome.tabs.onRemoved.addListener((tabId) => {
  if (pfSession?.tabId === tabId) pfSession = null
})

function pfFail(command: PortalFillWriteCommand, reason: PortalFillFailReason): PortalFillFieldResult {
  return {
    protocol: PORTAL_FILL_PROTOCOL_VERSION,
    kind: 'field_result',
    executionId: command.executionId,
    fieldKey: command.fieldKey,
    outcome: 'failed',
    reason,
    selectorFound: false,
  }
}

/**
 * Dispatch one signed intent to the BOUND tab's content script. Fail-closed if:
 * no session bound, executionId mismatch, protocol mismatch, tab unreachable, or
 * timeout. Tab-scoped: only pfSession.tabId ever receives a message. Never
 * submits/navigates (it relays; the executor writes).
 */
/**
 * Read-only selector presence check against the BOUND tab. Same tab-scoping as a
 * write dispatch: an unbound session probes nothing. Returns presence only —
 * `readback` also carries current field values, and those are deliberately
 * dropped here rather than relayed onward.
 */
async function pfProbe(
  selectors: string[],
  ops?: Array<PortalFillOp | null>,
  awaitOptions?: boolean[],
): Promise<
  { results: { selector: string; found: boolean; optionMissing?: boolean }[]; page: string | null } | { error: string }
> {
  if (!pfSession) return { error: 'no_session' }
  try {
    const raw = (await pfWithTimeout(
      sendToPortalTab(pfSession.tabId, {
        type: 'readback',
        selectors,
        ...(ops ? { ops } : {}),
        ...(awaitOptions ? { awaitOptions } : {}),
      }),
      PF_TIMEOUT_MS,
    )) as Array<{ selector: string; found: boolean; optionMissing?: boolean }> | undefined
    if (!Array.isArray(raw)) return { error: 'unreachable' }
    return {
      results: raw.map((r) => ({
        selector: r.selector,
        found: r.found,
        // Presence only: "its list lacks the answer" carries no value.
        ...(r.optionMissing === true && !r.found ? { optionMissing: true } : {}),
      })),
      page: await boundTabPath(),
    }
  } catch {
    return { error: 'unreachable' }
  }
}

/**
 * The bound tab's URL PATH — which IRCC page is open. Only the path: the query
 * string carries IRCC's application ids, which the server has no use for.
 * Null when the tab cannot be read.
 */
async function boundTabPath(): Promise<string | null> {
  if (!pfSession) return null
  try {
    const tab = await chrome.tabs.get(pfSession.tabId)
    return tab?.url ? new URL(tab.url).pathname : null
  } catch {
    return null
  }
}

async function pfDispatch(command: PortalFillWriteCommand): Promise<PortalFillFieldResult> {
  if (!pfSession) return pfFail(command, 'transport_error') // no bound session
  if (command.executionId !== pfSession.executionId) return pfFail(command, 'transport_error') // session mismatch
  if (!isPortalFillProtocolCompatible(command.protocol)) return pfFail(command, 'dom_change') // protocol mismatch
  try {
    const res = await pfWithTimeout(
      sendToPortalTab(pfSession.tabId, { type: 'execute-field-intent', command } satisfies ExtMessage),
      PF_TIMEOUT_MS,
    )
    return res as PortalFillFieldResult
  } catch (err) {
    const timedOut = err instanceof Error && err.message === 'pf-timeout'
    return pfFail(command, timedOut ? 'timeout' : 'transport_error')
  }
}

function pfWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('pf-timeout')), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

async function executeInActiveTab(instruction: FillInstruction): Promise<{ ok: boolean; detail?: string }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return { ok: false, detail: 'No active tab' }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'execute-step', instruction } satisfies ExtMessage)
    return response as { ok: boolean; detail?: string }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'Content script not reachable' }
  }
}
