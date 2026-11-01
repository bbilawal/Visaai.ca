import { pickPortalTab } from './portal-tab'
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

void (async () => {
  const stored = await chrome.storage.local.get('pendingSession')
  const pending = stored.pendingSession as PendingSession | undefined
  if (!pending) return
  // One-shot: cleared whether or not it is used, so a token doesn't
  // auto-reconnect on future side panel opens — and a STALE one is purged, not
  // merely skipped, because its readbackToken holds the applicant's mapped
  // values. Also tell background to drop the toolbar badge.
  await chrome.storage.local.remove('pendingSession')
  chrome.runtime.sendMessage({ type: 'session-consumed' }).catch(() => { /* no listener — fine */ })
  if (typeof pending.receivedAt === 'number' && Date.now() - pending.receivedAt < PENDING_SESSION_TTL_MS) {
    readbackToken = pending.readbackToken ?? null
    connect(pending.apiUrl, pending.token)
  }
})()

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
  // Tear down any prior socket to avoid duplicate listeners on reconnect
  socket?.disconnect()
  resumeToken = null
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
  socket.on('automation:ready', (data?: { resumeToken?: unknown; resumed?: unknown }) => {
    resumeToken = typeof data?.resumeToken === 'string' ? data.resumeToken : null
    if (data?.resumed === true) {
      // A resumed socket is re-authenticated, nothing more. The run it carried
      // was unbound on disconnect and its approval was spent at start, so it is
      // NOT restarted here — the user re-requests it with a fresh approval.
      setStatus('Reconnected.')
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
    socket!.emit('portal-fill:start', { readbackToken: approval })
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
        const tabId = await resolvePortalTab()
        if (tabId == null) {
          startRequested = true
          showError('Open the government portal tab in this window, then retry.')
          setStatus('No portal tab found.')
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
        fieldCount = 0
        $('steps').innerHTML = ''
        const next = document.getElementById('next')
        if (next) next.style.display = 'none'
        setStatus('Filling verified fields…')
        ack?.({ bound: true, executionId: msg.executionId })
        return
      }

      if (msg.stage === 'completed') {
        setStatus(
          `This page is filled: ${fieldCount} verified ${fieldCount === 1 ? 'entry' : 'entries'}. ` +
            'Check it, answer anything left blank, then click "Save and continue" on IRCC yourself.',
        )
        showNext(msg.nextPage ?? null)
        await unbind()
        ack?.({ ok: true })
        return
      }

      if (msg.stage === 'failed') {
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
      msg: { protocol: number; executionId: string; selectors: string[]; ops?: Array<PortalFillOp | null> },
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

  socket.on('automation:error', (data: { message: string }) => {
    showError(data.message)
    void unbind()
  })

  socket.on('connect_error', (err: Error) => {
    showError(`Connection failed: ${err.message}`)
  })

  socket.on('disconnect', (reason?: string) => {
    void unbind()
    // A server- or client-initiated close is final; anything else is a drop
    // socket.io will retry with the resume token.
    if (reason !== 'io server disconnect' && reason !== 'io client disconnect' && resumeToken) {
      setStatus('Connection lost — reconnecting…')
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

  const row = document.createElement('div')
  row.className = 'step'
  row.textContent = command.fieldKey
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
    if (ok) fieldCount += 1
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
  return pickPortalTab(await chrome.tabs.query({ currentWindow: true }))
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
 * Where to go next. The assistant fills the page that is open, one launch per
 * page; it never presses IRCC's "Save and continue".
 */
function showNext(next: { page: string; title: string } | null) {
  const el = document.getElementById('next')
  if (!el) return
  el.textContent = next
    ? `Next page with values to fill: "${next.title}". Save this page on IRCC, continue to it, then launch the assistant again from VisaAI.`
    : 'No later IRCC page has values for the assistant to fill. Complete the remaining pages yourself.'
  el.style.display = 'block'
}

function setStatus(text: string) {
  $('status').textContent = text
}

function showError(text: string) {
  $('error').textContent = text
}
