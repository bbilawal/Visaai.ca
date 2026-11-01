'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { getSession, refreshSession } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/providers/toast-provider'
import { handlePlanError } from '@/lib/plan-error'
import { startFormFeeCheckout } from '@/lib/payment-error'
import { CA_SPOUSAL_VISAAI_ID, formatPrefillPrice } from '@visaai/types'
import { ApiUnavailableError, isApiUnavailable, isRestartStatus } from '@/lib/api-unavailable'
import { useRequiredDocsReady, MissingDocsPanel } from '@/components/required-docs-gate'
import { OutcomeReporter } from '@/components/outcome-reporter'
import {
  CHROME_WEB_STORE_URL,
  extensionIdCandidates,
  findInstalledExtension,
} from '@/lib/extension-ids'
import { useSupportedCountries } from '@/lib/use-supported-countries'
import { requestExecution } from '@/lib/api/execution-client'
import { executionReasonText } from '@/lib/readback-reasons'
import ReadbackGate, { type ReadbackState } from './readback-gate'

type SessionStatus = 'pending' | 'active' | 'paused' | 'complete' | 'error'
type ExtensionState = 'checking' | 'installed' | 'missing' | 'unsupported'

// Minimal shape of chrome.runtime.sendMessage for the externally_connectable
// handoff. Declared locally because the web app doesn't ship @types/chrome.
interface ChromeRuntime {
  sendMessage: (
    extensionId: string,
    message: unknown,
    responseCallback: (response: unknown) => void,
  ) => void
  lastError?: { message: string }
}
interface ChromeWindow {
  runtime?: ChromeRuntime
}
declare global {
  interface Window {
    chrome?: ChromeWindow
  }
}

/**
 * The Web Store id and the self-host id (NEXT_PUBLIC_EXTENSION_ID) are both
 * tried; the one that answers the ping is used for every later message.
 */
const EXTENSION_IDS = extensionIdCandidates(process.env.NEXT_PUBLIC_EXTENSION_ID)
let activeExtensionId: string | null = null

/**
 * How long Launch waits for the extension to confirm the session hand-off.
 * The extension answers after storing the session, badging its icon and
 * switching to the portal tab, which takes well under a second. Without a
 * bound, a reply that never came (a service worker stopped mid-handoff) left
 * Launch spinning with no card and no error.
 */
const HANDOFF_TIMEOUT_MS = 15_000
/**
 * The first hand-off try. Live 2026-10-21: right after the extension was
 * reloaded, the first Launch reached nothing (a second click worked) — the
 * page's connection to a just-restarted extension can be gone, or its
 * service worker misses the first message. So the first try is short, and a
 * missed one is retried once after checking the extension again.
 */
const HANDOFF_FIRST_TRY_MS = 5_000

/** sendToExtension's answer when `timeoutMs` passed with no reply at all. */
const EXTENSION_TIMED_OUT = Symbol('extension-timed-out')

function sendToExtension<T>(
  message: unknown,
  extensionId?: string | null,
): Promise<T | null>
function sendToExtension<T>(
  message: unknown,
  extensionId: string | null,
  timeoutMs: number,
): Promise<T | null | typeof EXTENSION_TIMED_OUT>
function sendToExtension<T>(
  message: unknown,
  extensionId: string | null = activeExtensionId,
  timeoutMs?: number,
): Promise<T | null | typeof EXTENSION_TIMED_OUT> {
  // SEC-8001: never log the raw message or response — the launch payload
  // carries the portal-fill hand-off token. Log only a non-sensitive action
  // label, and only in development.
  const isDev = process.env.NODE_ENV !== 'production'
  const label =
    (message as { action?: string; type?: string } | null)?.action ??
    (message as { action?: string; type?: string } | null)?.type ??
    'unknown'
  return new Promise((resolve) => {
    const runtime = window.chrome?.runtime
    if (!runtime || !extensionId) return resolve(null)
    let settled = false
    const timer =
      timeoutMs != null
        ? setTimeout(() => {
            if (settled) return
            settled = true
            if (isDev) console.warn('[VisaAI] extension did not reply in time for action:', label)
            resolve(EXTENSION_TIMED_OUT)
          }, timeoutMs)
        : null
    const done = (value: T | null) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(value)
    }
    try {
      runtime.sendMessage(extensionId, message, (response) => {
        // chrome.runtime.lastError fires when the extension isn't installed
        // (or doesn't allow this origin) — that's our "missing" signal.
        if (runtime.lastError) {
          if (isDev)
            console.warn('[VisaAI] extension sendMessage error:', runtime.lastError.message, 'for action:', label)
          return done(null)
        }
        if (isDev) console.debug('[VisaAI] extension response for action:', label)
        done((response as T) ?? null)
      })
    } catch (err) {
      if (isDev) console.error('[VisaAI] extension sendMessage threw for action:', label, err)
      done(null)
    }
  })
}

/**
 * IRCC signs a tr-rt session out after ~20 minutes idle. Going back and forth
 * to VisaAI (to check a value, wait for the consultant) is enough, and the
 * unsaved IRCC page is lost. Dry run 2026-10-14 (#52) hit exactly that with no
 * guidance; the extension side panel repeats the same tips.
 */
function IrccSessionTips() {
  return (
    <Card variant="tight" className="mb-4" role="region" aria-label="Before you start on the IRCC portal">
      <p className="type-h4" style={{ marginBottom: 6 }}>Before you start on the IRCC portal</p>
      <ul className="sans" style={{ fontSize: '0.85rem', paddingLeft: 18, lineHeight: 1.7, margin: 0 }}>
        <li>
          IRCC signs you out after about 20 minutes without activity, and anything not
          saved on that page is lost. Save each IRCC page before you switch to VisaAI or
          another tab.
        </li>
        <li>
          If your session expired, sign in again and open your application from your
          IRCC account with <strong>Continue</strong> on the draft. Bookmarked or
          deep links to a form page go to an error page.
        </li>
        <li>
          Launch once and keep the assistant&apos;s side panel open: it fills each IRCC
          page as you reach it. You press <strong>Save and continue</strong> yourself.
          If you leave it idle for 15 minutes, launch again.
        </li>
        <li>
          Questions about your background (criminality, security, medical history) are
          only filled from answers you gave VisaAI. Any it leaves blank are listed below —
          answer them yourself.
        </li>
      </ul>
    </Card>
  )
}

/**
 * The Canada eTA is one page with no IRCC account: no sign-in, no Save and
 * continue. Questions appear as earlier ones are answered, and the assistant
 * fills the newly shown ones only when asked (dry run 2026-10-18).
 */
function EtaTips() {
  return (
    <Card variant="tight" className="mb-4" role="region" aria-label="Before you start on the eTA form">
      <p className="type-h4" style={{ marginBottom: 6 }}>Before you start on the eTA form</p>
      <ul className="sans" style={{ fontSize: '0.85rem', paddingLeft: 18, lineHeight: 1.7, margin: 0 }}>
        <li>
          The eTA form is a single page and needs no IRCC account: open it in a Chrome
          tab — there is nothing to sign in to.
        </li>
        <li>
          Launch once and keep the assistant&apos;s side panel open. It fills the
          questions shown. New questions appear as you answer: press the form&apos;s
          <strong> Next</strong> yourself, then <strong>Fill newly shown questions</strong> in
          the side panel.
        </li>
        <li>
          Questions about your background are only filled from answers you gave VisaAI.
          Any it leaves blank are listed below — answer them yourself.
        </li>
      </ul>
    </Card>
  )
}

export default function SubmissionClient({
  applicationId,
  destinationCountry = null,
  canLaunch = false,
  isEta = false,
  routeAssistedFill = true,
  visaaiId = null,
  ownerId,
}: {
  applicationId: string
  /** ISO-2 of the application's destination, or null if not set. */
  destinationCountry?: string | null
  /**
   * Whether the viewer owns the application. Only the applicant can launch the
   * portal assistant — the API refuses anyone else (403). A consultant or admin
   * opening this page sees the state read-only instead of a Launch button that
   * can only fail.
   */
  canLaunch?: boolean
  /** Canada eTA: one single-page form, no IRCC account. */
  isEta?: boolean
  /**
   * False for a route of an assisted country whose own portal form has no
   * fill mapping (Canada Express Entry): no Launch, the manual route instead.
   */
  routeAssistedFill?: boolean
  /** The application's `visa_types.visaai_id`; decides the form fee shown. */
  visaaiId?: string | null
  /** The applicant's user id; a launch from any other session is refused here. */
  ownerId?: string
}) {
  const t = useTranslations('submission')
  // Same table the API charges from, so the number shown is the number billed.
  const formFee = formatPrefillPrice(visaaiId)
  // Filed on the Permanent Residence Portal, not in an IRCC account.
  const spousal = visaaiId === CA_SPOUSAL_VISAAI_ID
  // The study permit (2026-10-20) and the work permit (2026-10-30) fill the
  // IRCC secure account's questionnaire, so neither is an unsupported route.
  const unsupportedTitle = spousal ? 'extUnsupportedRouteTitleSpousal' : 'extUnsupportedRouteTitle'
  const unsupportedBody = spousal ? 'extUnsupportedRouteBodySpousal' : 'extUnsupportedRouteBody'
  const { toast } = useToast()
  const [extState, setExtState] = useState<ExtensionState>('checking')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [portalUrl, setPortalUrl] = useState('')
  const [status, setStatus] = useState<SessionStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [handedOff, setHandedOff] = useState(false)
  const [showDocsGate, setShowDocsGate] = useState(false)
  /**
   * Whether this application's one-time form fee is paid, from GET /prefill.
   * Null while loading or when the API could not say — Launch then finds out
   * from the session call's 402 and asks before opening checkout.
   */
  const [formFeePaid, setFormFeePaid] = useState<boolean | null>(null)
  /** An unexpected 402 on launch: ask before sending the user to checkout. */
  const [feePrompt, setFeePrompt] = useState(false)
  const [startingCheckout, setStartingCheckout] = useState(false)
  const nextStepsRef = useRef<HTMLDivElement | null>(null)

  // A different application in the same mounted client (page.tsx also keys
  // it by id): drop everything the last launch left behind, so its Next card,
  // status or error never shows on this one. Reset during render, React's
  // pattern for state derived from a prop.
  const [stateFor, setStateFor] = useState(applicationId)
  if (stateFor !== applicationId) {
    setStateFor(applicationId)
    setHandedOff(false)
    setSessionId(null)
    setStatus(null)
    setError(null)
    setFeePrompt(false)
    setFormFeePaid(null)
    setShowDocsGate(false)
  }
  /**
   * Consultant lock + the applicant's own confirmation. Portal fill cannot be
   * requested until both hold — the API refuses an execution request without
   * userConfirmationFlag, and refuses a readback token without a valid lock.
   */
  const [readback, setReadback] = useState<ReadbackState>({
    confirmed: false,
    reviewId: null,
    mappings: null,
    fillable: null,
  })
  const { ready: docsReady, missing: missingDocs } = useRequiredDocsReady(applicationId)

  /**
   * Whether the extension can fill THIS application's portal.
   *
   * Asked of the API rather than compared against 'CA' here. The extension is
   * useless without a portal fill mapping, and only Canada has one — so
   * offering the install on a Japanese application would have someone follow
   * five install steps to reach a button that fills nothing. When the next
   * country's mapping lands, `assistedFill` flips on the server and this page
   * starts offering it with no change here.
   *
   * Undefined while loading, so the install block renders only once the answer
   * is known — a flash of an offer we then withdraw is worse than a beat of
   * nothing.
   */
  const { countries } = useSupportedCountries()
  const countryAssistedFill = destinationCountry
    ? countries.find(c => c.code === destinationCountry)?.assistedFill
    : false
  const assistedFillSupported = routeAssistedFill ? countryAssistedFill : false
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Read by the status poll through a ref: the translator is a new function
  // on every render, and as an effect dependency it restarted the poll.
  const notOwnerText = useRef('')
  /** The status poll stopped because another account is signed in. */
  const stoppedForOtherUser = useRef(false)
  /** Bumped to restart the status poll (the applicant is signed in again). */
  const [pollRun, setPollRun] = useState(0)
  useEffect(() => {
    notOwnerText.current = t('errNotOwner')
  })

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

  /**
   * `quiet`: the Launch hand-off's re-check. It leaves the extension card as it
   * is while it pings (no flicker to "checking" mid-launch).
   */
  const detectExtension = useCallback(async (quiet = false) => {
    if (typeof window === 'undefined') return

    // No `window.chrome` at all: Firefox, Safari, or a mobile browser. This is
    // the only genuinely UNSUPPORTED case, and the manual-submission card is
    // the right answer for it.
    if (!window.chrome) {
      setExtState('unsupported')
      return
    }

    // `chrome.runtime` is exposed to a PAGE only when an installed extension
    // declares this origin in externally_connectable. So in Chrome its absence
    // does not mean "this browser cannot do it" — it means NO CONNECTABLE
    // EXTENSION IS INSTALLED, which is exactly the `missing` case.
    //
    // Conflating the two is what hid the install card: a Chrome user with no
    // extension fell into `unsupported`, which renders the manual-submit card
    // and a permanently disabled launch button, while the card carrying the
    // install link only ever rendered for `missing` — a state that was
    // unreachable for the very users who needed it. Reported from production
    // 2026-08-13 by an operator who had installed from that button before.
    if (!window.chrome.runtime) {
      setExtState('missing')
      return
    }

    if (!quiet) setExtState('checking')
    activeExtensionId = await findInstalledExtension(EXTENSION_IDS, (id) =>
      sendToExtension<{ ok?: boolean; version?: string }>({ type: 'ping' }, id),
    )
    setExtState(activeExtensionId ? 'installed' : 'missing')
  }, [])

  useEffect(() => {
    // Defer off the commit so the synchronous setExtState inside detectExtension
    // doesn't fire during the effect body (avoids cascading-render lint/perf).
    const id = setTimeout(() => void detectExtension(), 0)
    return () => clearTimeout(id)
  }, [detectExtension])

  // Re-check when the window regains focus — covers the user installing the
  // extension in another tab and coming back.
  useEffect(() => {
    const onFocus = () => { void detectExtension() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [detectExtension])

  // Is the one-time form fee paid? Dry run 2026-10-18: Launch on an unpaid
  // application went straight to a live Stripe checkout with no warning. Asked
  // up front so the button can say what it will do. Only the applicant can
  // read their own prefill/payment state, so a non-owner never asks.
  useEffect(() => {
    if (!canLaunch) return
    let cancelled = false
    void (async () => {
      try {
        const { data: { session } } = await getSession()
        if (!session || cancelled) return
        const res = await fetch(`${apiUrl}/prefill/${applicationId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!res.ok || cancelled) return
        const data = await res.json() as { paid?: unknown }
        if (!cancelled && typeof data.paid === 'boolean') setFormFeePaid(data.paid)
      } catch {
        // Unknown stays null: the 402 on launch still asks before checkout.
      }
    })()
    return () => { cancelled = true }
  }, [apiUrl, applicationId, canLaunch])

  // Move focus to the next-step instructions once the hand-off succeeds, so
  // keyboard and screen-reader users land on what to do next.
  useEffect(() => {
    if (handedOff) nextStepsRef.current?.focus()
  }, [handedOff])

  async function goToCheckout() {
    setStartingCheckout(true)
    try {
      await startFormFeeCheckout(applicationId, toast)
    } finally {
      setStartingCheckout(false)
    }
  }

  async function handleLaunch() {
    if (!docsReady) {
      setShowDocsGate(true)
      toast(t('uploadDocsFirst'), 'error')
      return
    }
    // Open the assistant's side panel NOW, while this is still the click:
    // Chrome opens a side panel only in response to a user action, and the
    // awaits below would end it. The panel waits for the session handed off
    // further down. Not awaited; if Chrome refuses, the GO badge remains.
    // Skipped when this click is known to go to checkout instead.
    if (formFeePaid !== false) void sendToExtension({ type: 'open-panel' })
    setLoading(true)
    setError(null)
    setFeePrompt(false)
    setHandedOff(false)
    try {
      const { data: { session } } = await getSession()
      if (!session) throw new Error(t('notAuthenticated'))
      // Signed in as someone else since this page rendered (e.g. the
      // consultant in the same browser): say so instead of a 403.
      if (ownerId && session.user?.id && session.user.id !== ownerId) throw new Error(t('errNotOwner'))

      let res: Response
      try {
        res = await fetch(`${apiUrl}/automation/${applicationId}/session`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ portalUrl: portalUrl.trim() || undefined }),
        })
      } catch {
        // fetch rejects only when the API could not be reached at all.
        throw new ApiUnavailableError()
      }
      // 502/503/504 = nginx with no API behind it (a deploy restart).
      if (isRestartStatus(res.status)) throw new ApiUnavailableError()
      if (await handlePlanError(res, applicationId, toast)) return
      // 402 = the one-time form fee for this visa is unpaid. If the user saw
      // the fee and pressed "Pay form fee and launch", open checkout. If the
      // page did not know it was unpaid, ask first — never redirect to a live
      // checkout unannounced (dry run 2026-10-18).
      if (res.status === 402) {
        if (formFeePaid === false) await goToCheckout()
        else {
          setFormFeePaid(false)
          setFeePrompt(true)
        }
        return
      }
      // 403 = not the applicant's own application (e.g. the consultant).
      if (res.status === 403) throw new Error(t('errNotOwner'))
      if (!res.ok) throw new Error(t('errCreateSession'))
      // A session was created, so the form fee is settled (paid in another tab,
      // or the fee check above misread it): drop the fee notice.
      setFormFeePaid(true)
      const data = await res.json() as {
        sessionId: string
        token: string
        executionToken?: string
      }
      setSessionId(data.sessionId)
      setStatus('pending')

      // Exchange the consultant's lock + this user's confirmation for a signed
      // readback token. The token carries the reviewed mappings, so the server
      // reads the field values out of it at fill time rather than trusting
      // anything the extension sends. No token, no fill.
      if (!readback.confirmed || !readback.reviewId || !readback.mappings) {
        throw new Error(t('errNotConfirmed'))
      }
      const decision = await requestExecution(session.access_token, {
        applicationId,
        preflightReviewId: readback.reviewId,
        mappings: readback.mappings,
        // The execution gate validates the HMAC execution token; `token` is the
        // single-use socket connect token the extension redeems.
        token: data.executionToken ?? data.token,
        sessionId: data.sessionId,
        userConfirmationFlag: true,
      }).catch((err: unknown) => {
        throw isApiUnavailable(err) ? new ApiUnavailableError() : err
      })
      if (!decision.allowed || !decision.readbackToken) {
        throw new Error(
          decision.blockedReasons.length
            ? t('errExecBlocked', {
                reasons: [...new Set(decision.blockedReasons.map(executionReasonText))].join(' '),
              })
            : t('errExecBlockedUnknown'),
        )
      }

      // Hand the token straight to the extension. The extension stores it and
      // badges its toolbar icon — the user clicks the icon once to open the
      // side panel, which auto-connects from the stored session. Chrome
      // requires the side panel be opened by a direct user gesture inside the
      // extension's context, which the toolbar click satisfies.
      const handoff = {
        type: 'session',
        token: data.token,
        apiUrl,
        portalUrl: portalUrl.trim() || undefined,
        readbackToken: decision.readbackToken,
        // Which portal tab Launch switches to: one of these pages, never a
        // form page of another application left open (an old eTA tab).
        portalPages: [...new Set(readback.mappings.map(m => m.page).filter((p): p is string => !!p))],
      }
      let handed = await sendToExtension<{ ok?: boolean; detail?: string }>(handoff, activeExtensionId, HANDOFF_FIRST_TRY_MS)
      // No answer: check the extension again (it may have just restarted) and
      // try once more. Storing the same session twice is harmless.
      if (handed === EXTENSION_TIMED_OUT || handed == null) {
        await detectExtension(true)
        handed = await sendToExtension<{ ok?: boolean; detail?: string }>(handoff, activeExtensionId, HANDOFF_TIMEOUT_MS)
      }
      // The extension answers { ok: true } once the session is stored, or
      // { ok: false, detail } when it refused it. Still no answer after the
      // retry is said plainly: a silent Launch is what the dry run of
      // 2026-10-18 could not act on.
      if (handed === EXTENSION_TIMED_OUT || handed == null) throw new Error(t('errExtHandoffFailed'))
      if (handed.ok !== true) {
        throw new Error(handed.detail ? t('errExtRejectDetail', { detail: handed.detail }) : t('errExtReject'))
      }
      setHandedOff(true)
    } catch (err) {
      console.error('[VisaAI] launchSession failed:', err)
      // A deploy restarts the API for under a minute; say so, and leave Launch
      // enabled for the retry.
      if (err instanceof ApiUnavailableError) setError(t('errRestarting'))
      else setError(err instanceof Error ? err.message : t('errLaunch'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    // Consecutive failed polls, for the back-off; one 401 refresh per run.
    let failures = 0
    let skip = 0
    let refreshed = false

    /**
     * Stop for good: the browser is signed in as someone else. Live 2026-10-20:
     * the applicant's Submit tab stayed open while the browser was signed in
     * as the consultant (approving) and polled with the consultant's token —
     * 155 refusals (403), one a minute. Polling restarts on focus once the
     * applicant is signed in again (below).
     */
    const stopNotOwner = () => {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = null
      stoppedForOtherUser.current = true
      if (!cancelled) setError(notOwnerText.current)
    }

    async function poll() {
      // Back-off after failures: skip ticks (2 s, 4 s, 8 s … up to 30 s).
      if (skip > 0) {
        skip--
        return
      }
      try {
        const { data: { session } } = await getSession()
        if (!session || cancelled || !sessionId) return
        // Only a DIFFERENT signed-in user stops the poll; a refusal for the
        // owner is a transient failure (an expiring token, a read error).
        if (ownerId && session.user?.id && session.user.id !== ownerId) return stopNotOwner()
        const res = await fetch(`${apiUrl}/automation/session/${sessionId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (cancelled) return
        if (res.status === 401 && !refreshed) {
          refreshed = true
          await refreshSession().catch(() => undefined)
          return
        }
        if (!res.ok) {
          // No owner to compare with: a refusal is all there is to go on.
          if (!ownerId && (res.status === 401 || res.status === 403)) return stopNotOwner()
          failures++
          skip = Math.min(2 ** failures - 1, 14)
          return
        }
        failures = 0
        const data = await res.json() as { status: SessionStatus }
        if (!cancelled) setStatus(data.status)
        if (data.status === 'complete' || data.status === 'error') {
          if (pollRef.current) clearInterval(pollRef.current)
        }
      } catch {
        // Network blip or API unreachable — keep polling on next interval tick.
      }
    }

    stoppedForOtherUser.current = false
    void poll()
    pollRef.current = setInterval(poll, 2000)
    return () => {
      cancelled = true
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [sessionId, apiUrl, ownerId, pollRun])

  // Back on this tab as the applicant after another account stopped the poll:
  // start it again, and drop the "only the applicant" message.
  useEffect(() => {
    const onFocus = () => {
      if (!stoppedForOtherUser.current || !ownerId) return
      void getSession().then(({ data: { session } }) => {
        if (session?.user?.id !== ownerId) return
        stoppedForOtherUser.current = false
        setError(null)
        setPollRun((n) => n + 1)
      })
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [ownerId])

  return (
    <div style={{ maxWidth: 720 }}>
      <header className="page-head">
        <div className="page-head__intro">
          <span className="eyebrow">{t('eyebrow')}</span>
          <h1 className="type-h1" style={{ margin: '0 auto 44px' }}>{t('title')}</h1>
          <p className="lede">
            {assistedFillSupported ? t('lede') : t('ledeManual')}
          </p>
        </div>
      </header>

      {showDocsGate && !docsReady && (
        <MissingDocsPanel applicationId={applicationId} missing={missingDocs} />
      )}

      {extState === 'unsupported' && (
        <Card variant="tight" className="mb-4">
          <p className="type-h3">{t('manualTitle')}</p>
          <p className="sans" style={{ fontSize: '0.92rem', marginTop: 6, lineHeight: 1.6 }}>
            The Chrome Portal Assistant is an optional convenience that auto-fills the form. You
            can complete your application on any device by submitting it yourself. You stay in
            full control of payment and final submission.
          </p>
          <ol className="sans" style={{ fontSize: '0.92rem', marginTop: 12, paddingLeft: 18, lineHeight: 1.8 }}>
            <li>
              Download your prepared documents from your{' '}
              <a
                href={`/documents/${applicationId}`}
                className="font-medium underline underline-offset-2"
              >
                document vault
              </a>
              .
            </li>
            <li>
              Open the{' '}
              <a
                href="https://www.canada.ca/en/immigration-refugees-citizenship/services/application/account.html"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline underline-offset-2"
              >
                official government portal
              </a>{' '}
              and sign in.
            </li>
            <li>Enter your details using your prepared documents, then complete payment and submit.</li>
          </ol>
          <p className="sans" style={{ fontSize: '0.82rem', marginTop: 12, color: 'var(--color-midtone-gray)' }}>
            Prefer auto-fill? Open this page in Google Chrome, Edge, or Brave on a computer.
          </p>
        </Card>
      )}

      {routeAssistedFill && extState === 'installed' && (
        <Card variant="tight" className="mb-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="type-h3" style={{ margin: '0 auto 10px' }}>{t('extReady')}</p>
              <p className="sans" style={{ fontSize: '0.88rem', marginTop: 4, color: 'var(--color-midtone-gray)' }}>
                {isEta ? t('extReadyBodyEta') : t('extReadyBody')}
              </p>
            </div>
            <Badge variant="emerald">{t('installed')}</Badge>
          </div>
        </Card>
      )}

      {!canLaunch && (
        <Card variant="tight" className="mb-4">
          <p className="type-h3" style={{ marginBottom: 8 }}>Only the applicant can launch the portal assistant</p>
          <p className="sans" style={{ fontSize: '0.88rem', lineHeight: 1.6 }}>
            Auto-fill runs in the applicant&apos;s own browser, on the government portal,
            after they confirm the values below. You can
            see where things stand here; the applicant launches it from their account.
          </p>
        </Card>
      )}

      {!routeAssistedFill && (
        <Card variant="tight" className="mb-4" role="region" aria-label={t(unsupportedTitle)}>
          <p className="type-h3" style={{ marginBottom: 8 }}>{t(unsupportedTitle)}</p>
          <p className="sans" style={{ fontSize: '0.85rem', lineHeight: 1.7 }}>
            {t(unsupportedBody)}
          </p>
        </Card>
      )}

      {routeAssistedFill && canLaunch && destinationCountry === 'CA' && (isEta ? <EtaTips /> : <IrccSessionTips />)}

      {routeAssistedFill && canLaunch && (
      <Card variant="tight" className="mb-4">
        <label className="eyebrow" style={{ display: 'block', marginBottom: 8 }} htmlFor="portalUrl">
          {t('portalUrlLabel')}
        </label>
        <input
          id="portalUrl"
          type="url"
          value={portalUrl}
          onChange={(e) => setPortalUrl(e.target.value)}
          placeholder={isEta ? 'https://eta.onlineservices-servicesenligne.apps.cic.gc.ca/…' : 'https://onlineservices-servicesenligne.cic.gc.ca/…'}
          className="mono"
          style={{
            width: '100%',
            padding: '10px 12px',
            fontSize: '0.85rem',
            border: '1px solid var(--color-subtle-ash, #e5e5e5)',
            borderRadius: 6,
            background: 'var(--color-canvas-white, #fff)',
          }}
        />
        <p className="mono text-muted" style={{ fontSize: '0.75rem', marginTop: 8 }}>
          {t('portalUrlHint')}
        </p>
      </Card>
      )}

      {/* Consultant lock + the applicant's confirmation. Renders nothing when
          the destination has no portal mapping — the block below explains that
          case on its own. */}
      <ReadbackGate applicationId={applicationId} onChange={setReadback} readOnly={!canLaunch} isEta={isEta} />

      {/*
        * Everything Launch reports (next steps, fee prompt, error, fill
        * progress) renders HERE, directly above the Launch button. Dry run
        * 2026-10-18 (second pass): the hand-off succeeded, but this block sat
        * at the top of the page, above the tips, the portal URL and the
        * readback table, so the applicant at the Launch button saw no card and
        * no error. And the card was removed as soon as the session went
        * 'active', which is the moment the applicant comes back from opening
        * the side panel. It now stays until the fill completes or stops.
        */}
      {handedOff && status !== 'complete' && status !== 'error' && (
        /*
         * Dry run 2026-10-18: after a successful launch the applicant did not
         * know the next move. Chrome opens the side panel only from a click in
         * the extension's own UI, so the toolbar click is theirs to make —
         * say it as numbered steps, prominently, and announce it.
         */
        <div
          ref={nextStepsRef}
          tabIndex={-1}
          role="status"
          aria-label={isEta ? t('nextStepsTitleEta') : t('nextStepsTitle')}
          className="mb-4"
          style={{ outline: 'none' }}
        >
          <Card
            variant="tight"
            style={{ borderColor: 'var(--color-emerald, #1a6b40)', borderWidth: 2, borderStyle: 'solid' }}
          >
            <div className="flex items-center justify-between gap-3 mb-2">
              <p className="type-h3">{isEta ? t('nextStepsTitleEta') : t('nextStepsTitle')}</p>
              <Badge variant="emerald">GO</Badge>
            </div>
            <p className="sans text-muted" style={{ fontSize: '0.85rem', marginBottom: 8 }}>
              {t('sessionSent')}
            </p>
            <ol className="sans" style={{ fontSize: '1rem', paddingLeft: 22, lineHeight: 1.7, margin: 0 }}>
              <li>{isEta ? t('nextStep1Eta') : t('nextStep1')}</li>
              <li>{isEta ? t('nextStep2Eta') : t('nextStep2')}</li>
            </ol>
          </Card>
        </div>
      )}

      {feePrompt && (
        <div className="alert alert-warning mb-4" role="alert">
          <p style={{ margin: 0 }}>{t('feePromptBody', { amount: formFee })}</p>
          {isEta && <p style={{ margin: '6px 0 0' }}>{t('feeEtaIrccNote')}</p>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <Button size="sm" onClick={() => void goToCheckout()} loading={startingCheckout} disabled={startingCheckout}>
              {t('continueToPayment')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setFeePrompt(false)}>
              {t('notNow')}
            </Button>
          </div>
        </div>
      )}

      {error && <div className="alert alert-error mb-4" role="alert">{error}</div>}

      {/* The session ended in error (the side panel says why): the GO prompt
          would send the applicant to a panel with nothing left to fill. */}
      {status === 'error' && !error && (
        <div className="alert alert-error mb-4" role="alert">{t('errSessionStopped')}</div>
      )}

      {status === 'active' && (
        <Card variant="tight" className="mb-4">
          <div className="flex items-center justify-between gap-3">
            <p className="type-h3">{t('fillingProgress')}</p>
            <Badge variant="emerald">{t('active')}</Badge>
          </div>
        </Card>
      )}

      {status === 'complete' && (
        <Card variant="tight" className="mb-4">
          <div className="flex items-center justify-between gap-3">
            <p className="type-h3">{t('autoFillComplete')}</p>
            <Badge variant="emerald">{t('done')}</Badge>
          </div>
          <p className="sans" style={{ fontSize: '0.92rem', marginTop: 8 }}>
            {t('reviewFilled')}
          </p>
          {destinationCountry === 'CA' && isEta && (
            <p className="sans" style={{ fontSize: '0.88rem', marginTop: 8 }}>
              That filled the eTA questions that were showing. Answer anything left blank,
              press <strong>Next</strong> on the form, then <strong>Fill newly shown questions</strong> in
              the side panel. The declaration, signature and payment are yours.
            </p>
          )}
          {destinationCountry === 'CA' && !isEta && (
            <p className="sans" style={{ fontSize: '0.88rem', marginTop: 8 }}>
              That filled the IRCC page that was open. Answer anything left blank, press
              <strong> Save and continue</strong> on IRCC, and launch the assistant again on
              the next page — the side panel names the next page it has values for.
            </p>
          )}
        </Card>
      )}

      {!canLaunch || !routeAssistedFill ? null : extState === 'installed' || extState === 'checking' ? (
        <div className="mb-4">
          {formFeePaid === false && !feePrompt && (
            <Card variant="tight" className="mb-4" role="region" aria-label={t('feeUnpaidTitle', { amount: formFee })}>
              <p className="type-h4" style={{ marginBottom: 6 }}>{t('feeUnpaidTitle', { amount: formFee })}</p>
              <p className="sans" style={{ fontSize: '0.88rem', lineHeight: 1.6, margin: 0 }}>
                {t('feeUnpaidBody')}
              </p>
              {isEta && (
                <p className="sans" style={{ fontSize: '0.88rem', lineHeight: 1.6, margin: '6px 0 0' }}>
                  {t('feeEtaIrccNote')}
                </p>
              )}
            </Card>
          )}
          <p className="sans" style={{ fontSize: '0.88rem', lineHeight: 1.6, marginBottom: 10 }}>
            {isEta ? t('launchHintEta') : t('launchHint')}
          </p>
          <Button
            onClick={handleLaunch}
            disabled={loading || extState !== 'installed' || !readback.confirmed}
            size="lg"
          >
            {loading
              ? t('launching')
              : extState !== 'installed'
                ? t('checkingExt')
                : formFeePaid === false
                  ? t('launchPayFee')
                  : t('launchAssistant')}
          </Button>
        </div>
      ) : extState === 'missing' && assistedFillSupported === false ? (
        /*
         * This destination has no portal fill mapping, so there is nothing for
         * the extension to do here. Saying so is the whole point: the previous
         * behaviour offered the install on every application, and a Japanese
         * applicant who followed all five steps would arrive at an assistant
         * that fills nothing, because buildFillInstructions returns [] without
         * a mapping.
         */
        <Card variant="tight" className="mb-4">
          <p className="type-h3" style={{ marginBottom: 8 }}>{t('extUnsupportedTitle')}</p>
          <p className="sans" style={{ fontSize: '0.85rem', lineHeight: 1.7 }}>
            {t('extUnsupportedBody')}
          </p>
        </Card>
      ) : extState === 'missing' && assistedFillSupported ? (
        /*
         * The extension is NOT installed. This used to render a DISABLED button
         * reading "Install the extension first" with nothing to click and no
         * link anywhere on the page — a dead end. WEB_STORE_URL was computed at
         * the top of this file and never used.
         *
         * So: offer the install. The extension is published on the Chrome Web
         * Store, so the button opens that listing (a two-click install, no
         * developer mode); the store id is also tried when detecting it.
         */
        <Card variant="tight" className="mb-4">
          <p className="type-h3" style={{ marginBottom: 8 }}>{t('extInstallTitle')}</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <a href={CHROME_WEB_STORE_URL} target="_blank" rel="noopener noreferrer">
              <Button size="lg">{t('extInstall')}</Button>
            </a>
          </div>
          <ol className="sans" style={{ fontSize: '0.85rem', paddingLeft: 18, lineHeight: 1.7 }}>
            <li>{t('extStoreStep1')}</li>
            <li>{t('extStoreStep2')}</li>
            <li>{t('extStoreStep3')}</li>
          </ol>
          <p className="mono text-muted" style={{ fontSize: '0.75rem', marginTop: 10 }}>
            {t('extRecheckHint')}
          </p>
          <Button onClick={() => void detectExtension()} size="sm" variant="secondary" style={{ marginTop: 8 }}>
            {t('extRecheck')}
          </Button>
        </Card>
      ) : null}

      <OutcomeReporter applicationId={applicationId} />
    </div>
  )
}
