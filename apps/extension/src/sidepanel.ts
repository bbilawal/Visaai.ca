import { isPortalUrl, pickActivePortalTab } from './portal-tab'
import { classifyPortalPage, followPageKey, isEappEditUrl, isServerPagedUrl } from './portal-page'
import { staleRows } from './executor/stale-rows'
import { onPrCasePage } from './executor/file-attach'
import { isAutoAdvanceUrl, isTrrtInfoUrl, isTrrtSummaryUrl } from './trrt-pages'
import { io, Socket } from 'socket.io-client'
import {
  PORTAL_FILL_PROTOCOL_VERSION,
  isPortalFillProtocolCompatible,
  isTrustedApiUrl,
  PENDING_SESSION_TTL_MS,
} from './shared'
import type {
  ExtMessage,
  PortalFillOp,
  RequiredUpload,
  PortalFillFieldResult,
  PortalFillStageMessage,
  PortalFillWriteCommand,
} from './shared'

const $ = (id: string) => document.getElementById(id)!

let socket: Socket | null = null
let boundExecutionId: string | null = null
let fieldCount = 0
/**
 * Whether WE asked this server for a verified fill.
 *
 * `portal-fill:start` is gated on holding a readbackToken — the server-signed
 * approval — but everything after it is server-driven, and the handlers are
 * registered the moment we connect. Without this flag a server could open the
 * handshake itself by emitting `portal-fill:stage {stage:'started'}`, and the
 * panel would bind the portal tab and execute every write that followed. The
 * expected hash comes from that same server, so the readback would confirm the
 * server's own values as verified.
 */
let startRequested = false

/**
 * One launch covers the whole application. After each run the server renews
 * the approval (`portal-fill:renewed`) to this socket; when the applicant
 * moves the portal tab to another page, the panel starts the next run with
 * it. Before, every IRCC page needed a fresh launch from VisaAI and a
 * reopened panel (dry run 2026-10-16). Memory only — it dies with the panel.
 */
/** Row summaries the server sent for the page being filled (dialog_open values). */
let reviewedRows: string[] = []

/**
 * After a page is filled, tell the applicant about rows on it that are not in
 * the reviewed application (staleRows). Read-only; the text stays here.
 */
async function showStaleRows(): Promise<boolean> {
  const el = document.getElementById('stale')
  if (el) el.style.display = 'none'
  const reviewed = reviewedRows
  reviewedRows = []
  if (reviewed.length === 0 || !el) return false
  let rows: string[] = []
  try {
    const res = (await chrome.runtime.sendMessage({ type: 'pf-page-rows' } satisfies ExtMessage)) as unknown
    rows = Array.isArray(res) ? (res as string[]) : []
  } catch {
    return false
  }
  const stale = staleRows(rows, reviewed)
  if (stale.length === 0) return false
  el.textContent =
    'On IRCC but not in your reviewed application — delete it on IRCC yourself if it is wrong: ' +
    stale.join(' · ')
  el.style.display = 'block'
  return true
}

// ── Auto-advance (opt-in, owner decision 2026-10-31) ──────────────────────
// After a page's fill completes, press IRCC's "Save and continue" for the
// applicant — on the IRCC Portal (tr-rt) only, on allow-listed form pages
// only, never on Summary or later, at most once per page. Any doubt pauses
// it and says why; the applicant turns it back on. OFF by default and for
// this launch only (memory: a new launch starts with it off).

/** The applicant turned auto-advance on for this launch. */
let autoAdvance = false
/** The page (followPageKey) auto-advance last pressed "Save and continue" on. */
let lastAdvancedPath: string | null = null
/** Pressed on this page and waiting for IRCC to move on. */
let advanceFrom: string | null = null
let advanceWatch: ReturnType<typeof setTimeout> | null = null
/** IRCC's session-timeout warning is showing on the followed tab. */
let sessionWarningUp = false
/** The followed tab is on IRCC's "You selected" info page (isTrrtInfoUrl). */
let onInfoPage = false
/** How long IRCC gets to move on after "Save and continue" before auto-advance stops. */
export const ADVANCE_NAV_MS = 15_000

export const AUTO_ADVANCE_LABEL =
  'Auto-advance: press Save and continue for me after each page is filled (stops at Summary, never submits)'
export const SUMMARY_STOP = 'You reached the Summary. Review the summary yourself; nothing was submitted.'

/** Only the IRCC Portal (visitor visa, business visitor, super visa) has it. */
const autoAdvanceAvailable = () => sessionPortalId === 'ircc'

function setAdvanceNote(text: string): void {
  const el = document.getElementById('autoAdvanceNote')
  if (!el) return
  el.textContent = text
  el.style.display = text ? 'block' : 'none'
}

function clearAdvanceWatch(): void {
  if (advanceWatch) clearTimeout(advanceWatch)
  advanceWatch = null
  advanceFrom = null
}

/** Show the option for an IRCC Portal session; reset it for a new launch. */
function resetAutoAdvance(): void {
  autoAdvance = false
  lastAdvancedPath = null
  clearAdvanceWatch()
  const box = document.getElementById('autoAdvance') as HTMLInputElement | null
  if (box) box.checked = false
  const wrap = document.getElementById('autoAdvanceWrap')
  if (wrap) wrap.style.display = autoAdvanceAvailable() ? 'block' : 'none'
  setAdvanceNote('')
}

/** Stop auto-advancing and say why. The applicant can turn it back on. */
function pauseAutoAdvance(reason: string): void {
  if (!autoAdvance) return
  autoAdvance = false
  clearAdvanceWatch()
  const box = document.getElementById('autoAdvance') as HTMLInputElement | null
  if (box) box.checked = false
  setAdvanceNote(`Auto-advance paused: ${reason} Turn it back on when you are ready.`)
}

document.getElementById('autoAdvance')?.addEventListener('change', (ev) => {
  const on = (ev.target as HTMLInputElement).checked && autoAdvanceAvailable()
  autoAdvance = on
  if (!on) {
    clearAdvanceWatch()
    ;(ev.target as HTMLInputElement).checked = false
    setAdvanceNote('')
    return
  }
  lastAdvancedPath = null
  setAdvanceNote(
    'Auto-advance is on from the next page that fills. On this page, press Save and continue on IRCC yourself.',
  )
})

interface AdvanceCheckReply {
  settled: boolean
  rows: number
  errors: string[]
  required: string[]
  sessionWarning: boolean
}

/**
 * A page's fill completed with every write verified: press "Save and
 * continue" if, and only if, everything says it is safe. Anything else
 * pauses auto-advance with the reason.
 */
async function maybeAutoAdvance(left: unknown, staleShown: boolean): Promise<void> {
  if (!autoAdvance) return
  const tabId = followTabId
  if (tabId == null) return pauseAutoAdvance('the IRCC tab could not be found.')
  const tab = await chrome.tabs.get(tabId).catch(() => null)
  const url = tab?.url
  const page = classifyPortalPage(url, sessionPortalId)
  if (page.kind === 'wrong-portal') return pauseAutoAdvance('this tab is on a different IRCC application.')
  if (isTrrtSummaryUrl(url)) return pauseAutoAdvance(SUMMARY_STOP)
  // Never pressed there; the applicant continues and the next page carries on.
  if (isTrrtInfoUrl(url)) return
  if (page.kind !== 'form' || !isAutoAdvanceUrl(url))
    return pauseAutoAdvance('this is not a form page auto-advance knows. Continue on IRCC yourself.')
  const path = followPageKey(url)
  if (!path) return pauseAutoAdvance('the IRCC page could not be read.')
  if (path === lastAdvancedPath)
    return pauseAutoAdvance('IRCC showed the same page again after Save and continue. Check it for a message.')
  if (sessionWarningUp)
    return pauseAutoAdvance('IRCC is about to sign you out. Click "Continue session" on IRCC first.')
  if (staleShown)
    return pauseAutoAdvance('this page has rows that are not in your reviewed application (listed below). Check them first.')
  if (!Array.isArray(left))
    return pauseAutoAdvance('the assistant could not confirm nothing is left for you on this page. Check it and press Save and continue yourself.')
  if (left.length > 0)
    return pauseAutoAdvance(
      `fill these on this page yourself, then press Save and continue on IRCC: ${left.map(String).join('; ')}.`,
    )
  setAdvanceNote('Auto-advance: waiting for the page to settle before Save and continue…')
  let check: AdvanceCheckReply | null = null
  try {
    check = (await chrome.tabs.sendMessage(tabId, { type: 'advance-check' } satisfies ExtMessage)) as AdvanceCheckReply | null
  } catch {
    check = null
  }
  if (!autoAdvance) return
  if (!check || typeof check !== 'object') return pauseAutoAdvance('the IRCC page could not be read.')
  if (!check.settled)
    return pauseAutoAdvance('the page kept changing (a dialog open or rows still being added). Check it and press Save and continue yourself.')
  if (check.sessionWarning || sessionWarningUp)
    return pauseAutoAdvance('IRCC is about to sign you out. Click "Continue session" on IRCC first.')
  if (Array.isArray(check.errors) && check.errors.length)
    return pauseAutoAdvance(`IRCC shows a message on this page: ${check.errors.slice(0, 3).join(' · ')}. Fix it, then press Save and continue yourself.`)
  if (Array.isArray(check.required) && check.required.length)
    return pauseAutoAdvance(
      `IRCC still needs an answer to: ${check.required.slice(0, 5).join('; ')}. Answer ${check.required.length === 1 ? 'it' : 'them'}, then press Save and continue yourself.`,
    )
  // Still the same page, and no other run started meanwhile.
  const again = await chrome.tabs.get(tabId).catch(() => null)
  if (!autoAdvance) return
  if (followPageKey(again?.url) !== path || boundExecutionId || startRequested)
    return pauseAutoAdvance('the page changed before Save and continue was pressed.')
  lastAdvancedPath = path
  let res: { pressed?: boolean; reason?: string } | null = null
  try {
    res = (await chrome.tabs.sendMessage(tabId, {
      type: 'advance-press',
      path,
      rows: check.rows,
    } satisfies ExtMessage)) as { pressed?: boolean; reason?: string } | null
  } catch {
    res = null
  }
  if (!res?.pressed)
    return pauseAutoAdvance(`Save and continue was not pressed (${res?.reason ?? 'no answer from the page'}).`)
  setAdvanceNote('Auto-advance pressed Save and continue. The next page fills when IRCC opens it.')
  clearAdvanceWatch()
  advanceFrom = path
  advanceWatch = setTimeout(() => {
    advanceWatch = null
    void chrome.tabs
      .get(tabId)
      .then((t) => {
        if (advanceFrom === path && followPageKey(t?.url) === path)
          pauseAutoAdvance('IRCC did not move on after Save and continue. Check the page for a message and fix it.')
      })
      .catch(() => undefined)
  }, ADVANCE_NAV_MS)
}

/**
 * Answers verified on an earlier fill of this launch, as the remaining list
 * names them. The eTA form hides its first question ("Applying on behalf of
 * someone") once the applicant moves on, so the server — which only sees what
 * is on the page now — listed it as "not on the form yet" after it was filled
 * (live 2026-10-18), and the panel kept offering a fill with nothing to do.
 */
const filledThisLaunch = new Set<string>()
export const answerLabel = (label: string) =>
  label.replace(/ — (year|month|day)$/, '').replace(/ \(confirm\)$/, '')

let followToken: string | null = null
/**
 * The approval the run in progress was started with, until that run reports
 * its end. A run cut off by a dropped connection (live 2026-10-19: the API
 * restarted for a deploy mid-fill) never sends that report or a renewal, so
 * this is the only approval left to finish it with — reused only on the
 * applicant's click, and the server re-validates the lock live as for any run.
 */
let runApproval: string | null = null
/** Set when the connection dropped while a run was in progress. */
let interruptedApproval: string | null = null

export const RESUME_LABEL = 'Continue filling'
export const FILL_AGAIN_LABEL = 'Fill newly shown questions'

function startRun(approval: string): void {
  runApproval = approval
  socket?.emit('portal-fill:start', { readbackToken: approval })
}
/**
 * The launched session's portal ('ircc', 'ircc-eta', 'ircc-study', …), from
 * automation:ready. Pages of another IRCC application flow are not this
 * session's: the panel says where to go and fills nothing (live 2026-10-30).
 * Null with an older server: pages classify as before.
 */
let sessionPortalId: string | null = null
/** The portal tab the last run was bound to; only its page changes count. */
let followTabId: number | null = null
/** The page (followPageKey) the last run was started on, so it is not refilled. */
let lastRunPath: string | null = null
/** The last run was on a server-paged form (see followLoads). */
let lastRunServerPaged = false
/** The last run was on a "Modify my Answers" screen (isEappEditUrl). */
let lastRunEditing = false
/** The questionnaire's own button on the screen: Next, or "Update information" when editing one answer. */
const eappButton = (): string => (lastRunEditing ? 'Update information' : 'Next')
let followTimer: ReturnType<typeof setTimeout> | null = null
/**
 * Page loads of the followed tab, and the load the last run started on. On a
 * server-paged form (IRCC's secure-account questionnaire: every screen at
 * /eapp/eapp) a new load at the same path is the next screen, so it fills;
 * on every other portal the path alone decides, as before.
 */
let followLoads = 0
let lastRunLoad = -1
/**
 * Server-paged form: the screens (their questions) this launch has filled.
 * A screen that comes back — IRCC's validation error, a reload, Back — is
 * not filled again, so an answer the applicant corrected stays theirs.
 */
const filledScreens = new Set<string>()
/** The questions of the screen the run being bound will fill. */
let pendingScreen: string | null = null
/** Every answer the server said was still to fill, as of the last run. */
let lastRemaining: string[] = []

/** The bound tab's screen as one string (its questions), or null if unreadable. */
async function screenSignature(tabId: number): Promise<string | null> {
  try {
    const qs = (await chrome.tabs.sendMessage(tabId, { type: 'screen-questions' } satisfies ExtMessage)) as unknown
    return Array.isArray(qs) && qs.length > 0 ? qs.join('\n') : null
  } catch {
    return null
  }
}

/**
 * The questionnaire reached its end (Review your answers…): list every
 * reviewed answer that never filled, so a question IRCC re-worded (its label
 * no longer matched) is never silent.
 */
function showNeverFilled(): void {
  const never = lastRemaining.filter((l) => !filledThisLaunch.has(answerLabel(l)))
  if (never.length === 0) return
  const el = document.getElementById('next')
  if (!el) return
  el.textContent = `Not filled — the assistant never found these questions on a screen (IRCC may have changed their wording): ${never.join(', ')}. Check them on "Review your answers" and answer them yourself.`
  el.style.display = 'block'
}
/** Quiet time after a page change before filling: IRCC renders after load. */
export const FOLLOW_SETTLE_MS = 2500

/** Start the next page's run with the renewed approval, if everything still holds. */
function followTo(tabId: number, url: string | undefined): void {
  if (tabId === followTabId) onInfoPage = isTrrtInfoUrl(url)
  if (tabId !== followTabId || !isPortalUrl(url)) return
  // Sign-in, account home, IRCC's error page, fees/declaration/payment: say
  // what to do there and keep the launch for the next form page. Forget the
  // last page, so coming back to it after signing in fills it again.
  const page = classifyPortalPage(url, sessionPortalId)
  if (advanceFrom && followPageKey(url) !== advanceFrom) clearAdvanceWatch()
  if (autoAdvance && onInfoPage && page.kind !== 'wrong-portal')
    setAdvanceNote(
      'Auto-advance stays on. This page only explains what you chose: press "Continue to application" on IRCC yourself, and auto-advance carries on from the next page.',
    )
  else if (autoAdvance) {
    if (page.kind === 'wrong-portal') pauseAutoAdvance('this tab is on a different IRCC application.')
    else if (page.kind === 'error') pauseAutoAdvance('IRCC showed its error page.')
    else if (isTrrtSummaryUrl(url)) pauseAutoAdvance(SUMMARY_STOP)
    else if (page.kind !== 'form') pauseAutoAdvance('this is not a form page auto-advance knows.')
    else if (!isAutoAdvanceUrl(url))
      pauseAutoAdvance('this page is not one auto-advance knows. Check it and continue on IRCC yourself.')
  }
  if (page.kind !== 'form') {
    if (followTimer) clearTimeout(followTimer)
    followTimer = null
    lastRunPath = null
    showError('')
    setStatus(page.message ?? '')
    if (page.kind === 'review') showNeverFilled()
    return
  }
  const path = followPageKey(url)
  if (!path) return
  if (path === lastRunPath && !(isServerPagedUrl(url) && followLoads !== lastRunLoad)) return
  const load = followLoads
  if (followTimer) clearTimeout(followTimer)
  followTimer = setTimeout(() => {
    followTimer = null
    void (async () => {
      const tab = await chrome.tabs.get(tabId).catch(() => null)
      if (!tab || !isPortalUrl(tab.url) || followPageKey(tab.url) !== path) return
      // Another screen loaded during the quiet time: its own follow fills it.
      if (followLoads !== load) return
      if (!followToken || !socket?.connected || boundExecutionId || startRequested) return
      let screen: string | null = null
      if (isServerPagedUrl(tab.url)) {
        screen = await screenSignature(tabId)
        if (followLoads !== load || !followToken || boundExecutionId || startRequested) return
        if (screen && filledScreens.has(screen)) {
          // Same questions as a screen already filled: IRCC showed it again.
          lastRunPath = path
          lastRunLoad = load
          showError('')
          setStatus(
            `This screen was filled already, so it is left as it is — your own changes stay. Check it and press ${
              isEappEditUrl(tab.url) ? 'Update information' : 'Next'
            } on IRCC.`,
          )
          return
        }
      }
      pendingScreen = screen
      const approval = followToken
      followToken = null
      lastRunPath = path
      lastRunLoad = load
      startRequested = true
      showError('')
      setStatus('New page — filling verified fields…')
      startRun(approval)
    })()
  }, FOLLOW_SETTLE_MS)
}

chrome.tabs?.onUpdated?.addListener((tabId, changeInfo, tab) => {
  if (tab?.active && (changeInfo.url || tab.url)) showTipsFor(changeInfo.url ?? tab.url)
  if (tabId === followTabId && changeInfo.status === 'loading') followLoads += 1
  if (!changeInfo.url && changeInfo.status !== 'complete') return
  followTo(tabId, changeInfo.url ?? tab?.url)
})

/** The eTA form has its own host and none of the visitor-visa portal's sign-in or "Save and continue". */
export function isEtaUrl(url: string | undefined): boolean {
  try {
    return new URL(url ?? '').hostname.toLowerCase() === 'eta.onlineservices-servicesenligne.apps.cic.gc.ca'
  } catch {
    return false
  }
}

/** Show the tips for the portal in front: the IRCC account portal's, or the eTA form's. */
function showTipsFor(url: string | undefined): void {
  if (!isPortalUrl(url)) return
  const eta = isEtaUrl(url)
  const ircc = document.getElementById('ircc-tips')
  const etaTips = document.getElementById('eta-tips')
  if (ircc) ircc.style.display = eta ? 'none' : ''
  if (etaTips) etaTips.style.display = eta ? '' : 'none'
}

chrome.tabs?.onActivated?.addListener(({ tabId }) => {
  void chrome.tabs
    .get(tabId)
    .then((tab) => showTipsFor(tab?.url))
    .catch(() => undefined)
})
void chrome.tabs
  ?.query?.({ active: true, currentWindow: true })
  ?.then((tabs) => showTipsFor(tabs?.[0]?.url))
  ?.catch(() => undefined)

/** Portals this build is allowed to drive, mirroring manifest host_permissions. */

// Pending session left by the web app's "Launch assistant" button. If present
// we auto-connect and skip the manual form.

interface PendingSession {
  token: string
  apiUrl: string
  readbackToken?: string
  receivedAt: number
}

let readbackToken: string | null = null
/**
 * Reconnect credential handed out on `automation:ready` (REVIEW_HANDOFF item
 * 60). The connect token is single-use, so socket.io's automatic reconnect
 * must present this instead. Memory only — it dies with the panel.
 */
let resumeToken: string | null = null

/**
 * Take the session VisaAI handed off, if there is a fresh one.
 *
 * Runs when the panel opens AND whenever a new handoff lands while it is
 * already open. The assistant fills one IRCC page per launch; before this,
 * an open panel never noticed the next launch, so the applicant had to close
 * and reopen the panel on every one of the ~24 pages (dry run 2026-10-16).
 */
async function takePendingSession(): Promise<void> {
  const stored = await chrome.storage.local.get('pendingSession')
  const pending = stored.pendingSession as PendingSession | undefined
  if (!pending) return
  // One-shot: cleared whether or not it is used, so a token doesn't
  // auto-reconnect on future side panel opens — and a STALE one is purged, not
  // merely skipped, because its readbackToken holds the applicant's mapped
  // values. Also tell background to drop the toolbar badge.
  await chrome.storage.local.remove('pendingSession')
  chrome.runtime.sendMessage({ type: 'session-consumed' }).catch(() => { /* no listener — fine */ })
  // The same launch handed off twice (the page retried a slow reply): the
  // panel is already connected with this single-use token; reconnecting would
  // drop the live socket and present a spent token.
  if (pending.token === connectedToken) return
  if (typeof pending.receivedAt === 'number' && Date.now() - pending.receivedAt < PENDING_SESSION_TTL_MS) {
    readbackToken = pending.readbackToken ?? null
    connect(pending.apiUrl, pending.token)
  }
}

/** The session token this panel last connected with. */
let connectedToken: string | null = null

void takePendingSession()

chrome.storage.onChanged?.addListener((changes, area) => {
  if (area !== 'local' || !changes.pendingSession?.newValue) return
  void takePendingSession()
})

$('connectBtn').addEventListener('click', () => {
  const apiUrl = ($('apiUrl') as HTMLInputElement).value.trim()
  const token = ($('token') as HTMLInputElement).value.trim()
  if (!apiUrl || !token) {
    showError('Enter both API URL and token')
    return
  }
  connect(apiUrl, token)
})

function connect(apiUrl: string, token: string) {
  showError('')
  // Same rule the background worker applies to the web-app handoff (SEC-8510),
  // from the same definition. This path takes the URL from a text box, so it is
  // if anything the easier one to point at an attacker: a phishing page only has
  // to say "paste this into the VisaAI panel".
  if (!isTrustedApiUrl(apiUrl)) {
    showError('That API URL is not a VisaAI server. Start the fill from the VisaAI submission page.')
    setStatus('Not connected.')
    return
  }
  connectedToken = token
  // Tear down any prior socket to avoid duplicate listeners on reconnect
  socket?.disconnect()
  resumeToken = null
  // A new launch is a new session: an approval renewed for the old one would
  // be refused by the server anyway.
  followToken = null
  lastRunPath = null
  sessionPortalId = null
  resetAutoAdvance()
  sessionWarningUp = false
  bindGaveUp = false
  filledThisLaunch.clear()
  filledScreens.clear()
  lastRemaining = []
  runApproval = null
  interruptedApproval = null
  socket = io(`${apiUrl}/automation`, {
    transports: ['websocket'],
    // Evaluated on every (re)connect: the first handshake spends the connect
    // token, every later one the latest resume token the server issued.
    auth: (cb: (data: Record<string, string>) => void) =>
      cb(resumeToken ? { resumeToken } : { token }),
  })

  socket.on('connect', () => {
    setStatus('Connected. Authenticating…')
  })

  // Server confirms token auth before we request the run (avoids a
  // start-before-auth race).
  socket.on('automation:ready', (data?: { resumeToken?: unknown; resumed?: unknown; portalId?: unknown }) => {
    resumeToken = typeof data?.resumeToken === 'string' ? data.resumeToken : null
    if (typeof data?.portalId === 'string' && data.portalId) {
      const changed = sessionPortalId !== data.portalId
      sessionPortalId = data.portalId
      if (changed) resetAutoAdvance()
    }
    if (data?.resumed === true) {
      // A resumed socket is re-authenticated, nothing more. The run it carried
      // was unbound on disconnect and its approval was spent at start, so it is
      // NOT restarted here — the user re-requests it with a fresh approval.
      setStatus('Reconnected.')
      if (!readbackToken && followToken) {
        setStatus('Reconnected. The next IRCC page you open fills automatically.')
        return
      }
      if (!readbackToken && interruptedApproval) {
        // The cut-off run's approval finishes the page — on the applicant's
        // click, never automatically.
        followToken = interruptedApproval
        interruptedApproval = null
        lastRunPath = null
        showError('')
        setStatus(
          `The connection dropped while filling, so the fill paused. Nothing after the last checked field was written. Click "${RESUME_LABEL}" to finish.`,
        )
        const again = document.getElementById('fillAgain')
        if (again) {
          again.textContent = RESUME_LABEL
          again.style.display = 'block'
        }
        return
      }
      if (!readbackToken) {
        showError(
          'The connection dropped, so the fill was stopped. Nothing further was written — check the form, then start the fill again from the VisaAI submission page.',
        )
        return
      }
    }
    if (!readbackToken) {
      setStatus('Connected — review only.')
      showError(
        'No execution approval was handed off. Start the fill from the VisaAI submission page.',
      )
      return
    }
    setStatus('Authenticated. Requesting verified fill…')
    $('connect').style.display = 'none'
    $('session').style.display = 'block'
    startRequested = true
    // The approval authorizes one run. Spend it here so a reconnect — which
    // fires `automation:ready` again — can never replay it.
    const approval = readbackToken
    readbackToken = null
    startRun(approval)
  })

  // ── Phase 7J — verified fill protocol ────────────────────────────────────
  // stage:'started' is a HANDSHAKE, not a notification: the server holds every
  // write until we ack that a portal tab is bound to this executionId. Acking
  // without a bound tab would let the first intent race the binding.
  socket.on(
    'portal-fill:stage',
    async (msg: PortalFillStageMessage, ack?: (r: unknown) => void) => {
      if (!isPortalFillProtocolCompatible(msg?.protocol)) {
        showError('Extension is out of date for this server. Update it and retry.')
        ack?.({ bound: false })
        return
      }

      if (msg.stage === 'started') {
        // Only in response to a fill WE requested with an approval token.
        // Otherwise the server is opening the handshake on its own.
        if (!startRequested) {
          showError('Ignored an unrequested fill. Start the fill from the VisaAI submission page.')
          ack?.({ bound: false })
          return
        }
        // An approval authorizes exactly one handshake. Consume it NOW, before
        // any await: a second `started` delivered while this one is resolving
        // the tab or binding must find it already spent, or two executions can
        // pass the check. A bind that fails hands the approval back so the
        // same user request can still be retried.
        startRequested = false
        // Launch is clicked on the VisaAI tab, so that tab is usually in front
        // when the run starts; with two portal tabs open there was nothing to
        // pick and the fill failed ("did not bind a portal tab", dry run
        // 2026-10-16). Wait for the applicant to switch to the portal tab.
        let tabId = await resolvePortalTab()
        if (tabId == null) {
          if (!portalNotice) setStatus('Switch to the IRCC tab — filling starts as soon as it is in front.')
          tabId = await waitForPortalTab(PORTAL_TAB_WAIT_MS)
        }
        if (tabId == null) {
          startRequested = true
          bindGaveUp = true
          if (portalNotice) {
            showError(
              'The launch timed out before a form page of your application was open. Sign in and open the draft on IRCC, then click "Launch assistant" on VisaAI again.',
            )
            setStatus(portalNotice)
          } else {
            showError('Open the government portal tab in this window, then retry.')
            setStatus('No portal tab found.')
          }
          ack?.({ bound: false })
          return
        }
        const res = (await chrome.runtime.sendMessage({
          type: 'pf-bind-session',
          executionId: msg.executionId,
          tabId,
        } satisfies ExtMessage)) as { ok: boolean } | undefined

        if (!res?.ok) {
          startRequested = true
          showError('Could not bind the portal tab.')
          ack?.({ bound: false })
          return
        }
        boundExecutionId = msg.executionId
        bindGaveUp = false
        reviewedRows = []
        const staleEl = document.getElementById('stale')
        if (staleEl) staleEl.style.display = 'none'
        followTabId = tabId
        const boundTab = await chrome.tabs.get(tabId).catch(() => null)
        lastRunPath = followPageKey(boundTab?.url) ?? lastRunPath
        lastRunLoad = followLoads
        lastRunServerPaged = isServerPagedUrl(boundTab?.url)
        lastRunEditing = isEappEditUrl(boundTab?.url)
        if (lastRunServerPaged) {
          const screen = pendingScreen ?? (await screenSignature(tabId))
          if (screen) filledScreens.add(screen)
        }
        pendingScreen = null
        fieldCount = 0
        $('steps').innerHTML = ''
        const next = document.getElementById('next')
        if (next) next.style.display = 'none'
        const again = document.getElementById('fillAgain')
        if (again) again.style.display = 'none'
        setStatus('Filling verified fields…')
        ack?.({ bound: true, executionId: msg.executionId })
        return
      }

      if (msg.stage === 'completed') {
        runApproval = null
        if (Array.isArray(msg.remaining)) {
          // One page revealed step by step (eTA): its path never changes, so
          // the next run is the applicant's click, not a page change.
          setStatus(
            `Filled ${fieldCount} verified ${fieldCount === 1 ? 'entry' : 'entries'} on this form. Check ${fieldCount === 1 ? 'it' : 'them'}.`,
          )
          showRemaining(msg.remaining)
          pauseAutoAdvance('this page is not one auto-advance knows.')
          // IRCC /doc-upload is such a page too (progressive): its required
          // documents still to upload are read here, before the unbind.
          await showMissingUploads()
          await unbind()
          ack?.({ ok: true })
          return
        }
        setStatus(
          `This page is filled: ${fieldCount} verified ${fieldCount === 1 ? 'entry' : 'entries'}. ` +
            (autoAdvance
              ? 'Auto-advance checks it before pressing "Save and continue".'
              : 'Check it, then click "Save and continue" on IRCC — the next page fills automatically.'),
        )
        showNext(msg.nextPage ?? null)
        const staleShown = await showStaleRows()
        await showMissingUploads()
        await unbind()
        ack?.({ ok: true })
        await maybeAutoAdvance(msg.left, staleShown)
        return
      }

      if (msg.stage === 'failed' && bindGaveUp) {
        ack?.({ ok: true })
        return
      }

      if (msg.stage === 'failed') {
        runApproval = null
        // IRCC's "You selected" page has no fields and is never pressed: a run
        // that fails there (live 2026-10-31, right after /purpose) changes
        // nothing, and the next form page is checked on its own.
        if (!onInfoPage)
          pauseAutoAdvance('a field on this page did not fill and verify. Fill the rest yourself, then press Save and continue.')
        showError(
          `Stopped at "${msg.failedLabel ?? msg.failedFieldKey ?? 'unknown field'}" (${msg.reason ?? 'unknown'}). ` +
            'Nothing after it was written — fill the rest of this page yourself.',
        )
        setStatus('Stopped on an unverified field.')
        showNext(msg.nextPage ?? null)
        await unbind()
        ack?.({ ok: true })
      }
    },
  )

  // Read-only pre-flight: which mapped selectors exist on this page? Answering
  // honestly here is what turns a mismatched portal into "nothing was filled"
  // instead of "half the form was filled". We forward only presence booleans —
  // the readback also carries the values currently in the fields, and the server
  // has no business learning what is already typed into someone's application.
  socket.on(
    'portal-fill:probe',
    async (
      msg: {
        protocol: number
        executionId: string
        selectors: string[]
        ops?: Array<PortalFillOp | null>
        awaitOptions?: boolean[]
      },
      ack?: (r: unknown) => void,
    ) => {
      const reply = (results: { selector: string; found: boolean }[], page: string | null) =>
        ack?.({
          protocol: PORTAL_FILL_PROTOCOL_VERSION,
          kind: 'probe_result',
          executionId: msg?.executionId,
          results,
          // Which IRCC page is open (path only). The server fills that page's
          // group and nothing else.
          ...(page ? { page } : {}),
        })

      if (
        !isPortalFillProtocolCompatible(msg?.protocol) ||
        !boundExecutionId ||
        msg.executionId !== boundExecutionId
      ) {
        ack?.({ protocol: PORTAL_FILL_PROTOCOL_VERSION, kind: 'probe_result', executionId: msg?.executionId, results: [] })
        return
      }

      setStatus('Checking the portal page…')
      const res = (await chrome.runtime.sendMessage({
        type: 'pf-probe',
        selectors: msg.selectors,
        ...(Array.isArray(msg.ops) ? { ops: msg.ops } : {}),
        ...(Array.isArray(msg.awaitOptions) ? { awaitOptions: msg.awaitOptions.map((a) => a === true) } : {}),
      } satisfies ExtMessage)) as
        | { results?: { selector: string; found: boolean }[]; page?: string | null; error?: string }
        | undefined

      // No results = unknown, not "all present". An empty array cannot satisfy
      // the server's length check, so unknown reads as a refusal there.
      reply(res?.results ?? [], typeof res?.page === 'string' ? res.page : null)
    },
  )

  // One field, one write, one ack. The server races this against its own
  // timeout, so we always ack exactly once — including on failure.
  socket.on(
    'portal-fill:write',
    async (command: PortalFillWriteCommand, ack?: (r: PortalFillFieldResult) => void) => {
      const result = await executeField(command)
      ack?.(result)
    },
  )

  socket.on(
    'portal-fill:renewed',
    (msg?: { protocol?: number; readbackToken?: unknown; resumeToken?: unknown }) => {
      if (!isPortalFillProtocolCompatible(msg?.protocol ?? -1)) return
      // A fresh resume credential keeps a long multi-page session resumable
      // after a dropped connection.
      if (typeof msg?.resumeToken === 'string') resumeToken = msg.resumeToken
      if (typeof msg?.readbackToken !== 'string') return
      followToken = msg.readbackToken
      // The applicant may have moved on while that run was busy: IRCC's
      // "Continue" passes through pages before landing on /purpose, and a
      // page reached mid-run was skipped for good (live 2026-10-18: a new
      // draft's Purpose page said "Nothing to fill"). Catch up on the page
      // that is open now; lastRunPath stops a second run on the same page.
      if (followTabId != null) {
        const id = followTabId
        void chrome.tabs
          .get(id)
          .then((tab) => followTo(id, tab?.url))
          .catch(() => undefined)
      }
    },
  )

  socket.on('automation:error', (data: { message: string }) => {
    if (bindGaveUp && /did not bind/i.test(data?.message ?? '')) {
      bindGaveUp = false
      void unbind()
      return
    }
    // A page with nothing to fill (Representative, Summary, uploads) is not a
    // failure while following the applicant through the portal.
    if (/can no longer be resumed|invalid or expired session token/i.test(data?.message ?? '')) {
      endSession()
      return
    }
    if (
      autoAdvance &&
      !(onInfoPage && /no reviewed values for this page/i.test(data?.message ?? '')) &&
      !/can no longer be resumed|invalid or expired session token/i.test(data?.message ?? '')
    )
      pauseAutoAdvance(
        /no reviewed values for this page/i.test(data?.message ?? '')
          ? 'nothing is mapped on this page. Answer what IRCC asks and press Save and continue yourself.'
          : 'the assistant could not fill this page.',
      )
    if (/no reviewed values for this page/i.test(data?.message ?? '')) {
      setStatus('Nothing to fill on this page. Continue on IRCC — the next page fills automatically.')
      showError('')
    } else if (/^Nothing to fill on this screen/i.test(data?.message ?? '')) {
      // Not a failure either: an earlier page's "Stopped on an unverified
      // field" must not stay beside it (live 2026-10-20, IMM 5406 Section B).
      setStatus(data.message.replace(/press Next\b/, `press ${eappButton()}`))
      showError('')
    } else {
      showError(data.message)
    }
    void showMissingUploads().then(unbind)
  })

  socket.on('connect_error', (err: Error) => {
    showError(`Connection failed: ${err.message}`)
  })

  socket.on('disconnect', (reason?: string) => {
    if ((boundExecutionId || startRequested) && runApproval) interruptedApproval = runApproval
    runApproval = null
    void unbind()
    // A server- or client-initiated close is final; anything else is a drop
    // socket.io will retry with the resume token.
    if (reason !== 'io server disconnect' && reason !== 'io client disconnect' && resumeToken) {
      setStatus('Connection lost — reconnecting…')
    } else if (reason === 'io server disconnect') {
      endSession()
    }
  })
}

/**
 * Relay one write command to the background bridge, which dispatches it to the
 * BOUND tab's content script. Every failure path returns a well-formed
 * field_result — the server must never be left waiting on a silent error.
 */
async function executeField(
  command: PortalFillWriteCommand,
): Promise<PortalFillFieldResult> {
  const fail = (reason: PortalFillFieldResult['reason']): PortalFillFieldResult => ({
    protocol: PORTAL_FILL_PROTOCOL_VERSION,
    kind: 'field_result',
    executionId: command?.executionId ?? '',
    fieldKey: command?.fieldKey ?? '',
    outcome: 'failed',
    reason,
    selectorFound: false,
  })

  if (!isPortalFillProtocolCompatible(command?.protocol)) return fail('dom_change')
  // Refuse anything not for the execution we bound. A command for another run
  // is not ours to write.
  if (!boundExecutionId || command.executionId !== boundExecutionId) {
    return fail('transport_error')
  }

  if (command.op === 'dialog_open' && command.mappedValue) reviewedRows.push(command.mappedValue)

  const row = document.createElement('div')
  row.className = 'step'
  // The confirmed label ("Passport number"); an older server sends only the key.
  row.textContent = command.label || command.fieldKey
  $('steps').appendChild(row)

  try {
    const res = (await chrome.runtime.sendMessage({
      type: 'pf-execute-field',
      command,
    } satisfies ExtMessage)) as PortalFillFieldResult | undefined

    if (!res) {
      row.classList.add('fail')
      return fail('transport_error')
    }
    const ok = res.outcome === 'verified'
    row.classList.add(ok ? 'done' : 'fail')
    if (ok) {
      fieldCount += 1
      filledThisLaunch.add(answerLabel(command.label || command.fieldKey))
    }
    return res
  } catch {
    row.classList.add('fail')
    return fail('transport_error')
  }
}

/**
 * The tab the fill will target: the active tab in this window, accepted only if
 * it is on a portal this build has host permissions for. Deliberately narrow —
 * we never search other windows for "a portal-looking tab", because writing into
 * a tab the user is not looking at is exactly the surprise to avoid.
 */
async function resolvePortalTab(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ currentWindow: true })
  const id = pickActivePortalTab(tabs)
  if (id == null) return null
  portalNotice = null
  // A portal tab that is not on a form page (signed out, account home, error
  // page) is not bound: there is nothing to fill there. Say what to do.
  const tab = tabs.find((t) => t.id === id)
  const page = classifyPortalPage(tab?.url, sessionPortalId)
  // Still loading (the applicant just clicked "Continue" on the draft): the
  // page cannot be read yet, so binding now fails the probe ("Could not read
  // the portal page", live 2026-10-17). Wait for the load.
  if (page.kind === 'form' && tab?.status === 'loading') return null
  if (page.kind === 'form') return id
  portalNotice = page.message ?? null
  setStatus(portalNotice ?? '')
  return null
}

/** What the portal tab in front needs from the applicant before a run can bind, if anything. */
let portalNotice: string | null = null
/**
 * The panel gave up waiting for a form page and already told the applicant
 * what to do; the server's own "failed"/"did not bind" that follow must not
 * replace that with "Stopped on an unverified field" (live 2026-10-17).
 */
let bindGaveUp = false

/**
 * How long a run waits for a portal FORM page; inside the server's 180 s bind
 * timeout. Long enough to sign in again and open the draft after launching.
 */
export const PORTAL_TAB_WAIT_MS = 170_000

async function waitForPortalTab(ms: number): Promise<number | null> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500))
    const id = await resolvePortalTab()
    if (id == null) continue
    // The page came to the front (or loaded) during the wait and renders
    // after its load: give it the quiet time a followed page gets, then make
    // sure it is still the one.
    await new Promise((r) => setTimeout(r, FOLLOW_SETTLE_MS))
    if ((await resolvePortalTab()) === id) return id
  }
  return null
}

async function unbind() {
  // Cleared even when nothing was bound: a disconnect ends the approval, so a
  // reconnecting server cannot inherit it.
  startRequested = false
  if (!boundExecutionId) return
  boundExecutionId = null
  try {
    await chrome.runtime.sendMessage({ type: 'pf-unbind-session' } satisfies ExtMessage)
  } catch {
    /* background already gone — nothing to unbind */
  }
}

/**
 * A single page revealed step by step (IRCC eTA): what the assistant has
 * answers for but could not see yet, and the one control that fills them.
 * The applicant presses the form's own Next; the assistant never does.
 */
function showRemaining(all: string[]) {
  lastRemaining = all
  const remaining = all.filter((l) => !filledThisLaunch.has(answerLabel(l)))
  const el = document.getElementById('next')
  const again = document.getElementById('fillAgain')
  if (lastRunServerPaged) {
    // One question a screen, each screen a new page load that fills itself:
    // nothing to click here, and the questions still ahead are most of them.
    if (el) {
      el.textContent = remaining.length
        ? `Check this screen, then press ${eappButton()} on IRCC — the next question the assistant has an answer for fills when it opens.`
        : 'Every reviewed answer is filled. Continue to "Review your answers" and check them: the assistant stops there.'
      el.style.display = 'block'
    }
    if (again) again.style.display = 'none'
    return
  }
  if (el) {
    el.textContent = remaining.length
      ? `Not on the form yet: ${remaining.join(', ')}. Answer the questions shown and press the form's Next button, then "Fill newly shown questions".`
      : 'Every reviewed answer is filled. Complete the rest of the form, the declaration, your signature and the payment yourself.'
    el.style.display = 'block'
  }
  if (again) again.style.display = remaining.length ? 'block' : 'none'
}

/**
 * What to do once the connection to VisaAI is gone for good. The server
 * refuses a resume after a few minutes, so a laptop that slept mid-form comes
 * back to a closed session; telling the applicant "A fill is already running"
 * there (live 2026-10-18) left them clicking a button that could never work.
 */
export const SESSION_ENDED_MESSAGE =
  'The connection to VisaAI ended, so nothing more will be filled. Go to the VisaAI submission page and click "Launch assistant" again — answers already on the form stay there.'

function endSession(): void {
  pauseAutoAdvance('the connection to VisaAI ended.')
  followToken = null
  startRequested = false
  if (followTimer) clearTimeout(followTimer)
  followTimer = null
  const again = document.getElementById('fillAgain')
  if (again) again.style.display = 'none'
  setStatus('Disconnected.')
  showError(SESSION_ENDED_MESSAGE)
}

/** Start the next run on the SAME page, with the renewed approval, on the applicant's click. */
function fillAgain() {
  if (!socket?.connected) {
    endSession()
    return
  }
  if (!followToken || boundExecutionId || startRequested) {
    showError(followToken ? 'A fill is already running.' : 'Not ready yet — wait a moment and try again.')
    return
  }
  const approval = followToken
  followToken = null
  startRequested = true
  showError('')
  const again = document.getElementById('fillAgain')
  const resuming = again?.textContent === RESUME_LABEL
  if (again) {
    again.style.display = 'none'
    again.textContent = FILL_AGAIN_LABEL
  }
  setStatus(resuming ? 'Continuing the fill…' : 'Filling newly shown questions…')
  startRun(approval)
}

document.getElementById('fillAgain')?.addEventListener('click', fillAgain)

/**
 * Where to go next. The assistant fills the page that is open and follows the
 * applicant to the next one; it presses IRCC's "Save and continue" only when
 * the applicant turned auto-advance on (maybeAutoAdvance).
 */
function showNext(next: { page: string; title: string } | null) {
  const el = document.getElementById('next')
  if (!el) return
  el.textContent = next
    ? `Next page with values to fill: "${next.title}". Save this page on IRCC and continue — keep this panel open and it fills automatically.`
    : // Null also on a page outside the form (IRCC's opening questions,
      // live 2026-10-18), where "no later page" was false: every form page
      // was still ahead.
      'Continue on IRCC. Keep this panel open — each page the assistant has values for fills when you reach it.'
  el.style.display = 'block'
}

/**
 * On IRCC /doc-upload (and the PR portal's application page): the required
 * documents that still show "Not uploaded".
 * IRCC will not let the applicant continue to Fees until each one is there,
 * so say which, and that a form to sign must be signed first. Read-only.
 */
async function showMissingUploads(): Promise<void> {
  const el = document.getElementById('uploads')
  if (el) el.style.display = 'none'
  // IRCC tr-rt /doc-upload, or the PR portal's application page (followPageKey: its path).
  const pr = !!lastRunPath && onPrCasePage(lastRunPath)
  if (!el || !(lastRunPath?.endsWith('/doc-upload') || pr) || !boundExecutionId) return
  let rows: RequiredUpload[] = []
  try {
    const res = (await chrome.runtime.sendMessage({ type: 'pf-upload-status' } satisfies ExtMessage)) as unknown
    rows = Array.isArray(res) ? (res as RequiredUpload[]) : []
  } catch {
    return
  }
  const missing = rows.filter((r) => !r.uploaded).map((r) => r.name)
  el.textContent = pr
    ? missing.length
      ? `Still required before you can submit on IRCC: ${missing.join(' · ')}. Upload ${missing.length === 1 ? 'it' : 'them'} on IRCC yourself — IMM 1344, 5532 and 5533 must be signed first, or IRCC returns the application.`
      : rows.length
        ? 'Every required document shows a file. Check each one, then complete the consent and declaration and submit on IRCC yourself — paying, signing and submitting are yours.'
        : ''
    : missing.length
      ? `Still required before IRCC lets you pay: ${missing.join(' · ')}. Upload ${missing.length === 1 ? 'it' : 'them'} on IRCC yourself — a form that needs a signature (such as IMM 5476) must be signed first, or IRCC returns the application.`
      : rows.length
        ? 'Every required document is uploaded. Check each file, then continue on IRCC to Fees — the fees, declaration, signature and payment are yours.'
        : ''
  el.style.display = el.textContent ? 'block' : 'none'
}

// IRCC is about to sign the applicant out (its own warning dialog, reported
// by the content script of the portal tab this panel follows).
chrome.runtime.onMessage?.addListener((msg: ExtMessage, sender) => {
  if (msg?.type !== 'portal-session-warning') return
  if (followTabId != null && sender.tab?.id !== followTabId) return
  sessionWarningUp = msg.shown === true
  if (sessionWarningUp) pauseAutoAdvance('IRCC is about to sign you out. Click "Continue session" on IRCC first.')
  const el = document.getElementById('sessionWarning')
  if (!el) return
  el.textContent = msg.shown
    ? 'IRCC will sign you out in a few minutes. Go to the IRCC tab and click "Continue session" — answers you have not saved on that page are lost if it signs you out.'
    : ''
  el.style.display = msg.shown ? 'block' : 'none'
})

function setStatus(text: string) {
  $('status').textContent = text
}

function showError(text: string) {
  $('error').textContent = text
}
