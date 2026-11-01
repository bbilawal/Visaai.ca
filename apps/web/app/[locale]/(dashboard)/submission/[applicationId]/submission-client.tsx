'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { getSession } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/providers/toast-provider'
import { handlePlanError } from '@/lib/plan-error'
import { handlePaymentRequired } from '@/lib/payment-error'
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

function sendToExtension<T>(
  message: unknown,
  extensionId: string | null = activeExtensionId,
): Promise<T | null> {
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
    try {
      runtime.sendMessage(extensionId, message, (response) => {
        // chrome.runtime.lastError fires when the extension isn't installed
        // (or doesn't allow this origin) — that's our "missing" signal.
        if (runtime.lastError) {
          if (isDev)
            console.warn('[VisaAI] extension sendMessage error:', runtime.lastError.message, 'for action:', label)
          return resolve(null)
        }
        if (isDev) console.debug('[VisaAI] extension response for action:', label)
        resolve((response as T) ?? null)
      })
    } catch (err) {
      if (isDev) console.error('[VisaAI] extension sendMessage threw for action:', label, err)
      resolve(null)
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
          The assistant fills the page that is open. Launch it again on each IRCC page
          you want filled; you press <strong>Save and continue</strong> yourself.
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

export default function SubmissionClient({
  applicationId,
  destinationCountry = null,
  canLaunch = false,
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
}) {
  const t = useTranslations('submission')
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
  const assistedFillSupported = destinationCountry
    ? countries.find(c => c.code === destinationCountry)?.assistedFill
    : false
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

  const detectExtension = useCallback(async () => {
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

    setExtState('checking')
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

  async function handleLaunch() {
    if (!docsReady) {
      setShowDocsGate(true)
      toast(t('uploadDocsFirst'), 'error')
      return
    }
    setLoading(true)
    setError(null)
    setHandedOff(false)
    try {
      const { data: { session } } = await getSession()
      if (!session) throw new Error(t('notAuthenticated'))

      const res = await fetch(`${apiUrl}/automation/${applicationId}/session`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ portalUrl: portalUrl.trim() || undefined }),
      })
      if (await handlePlanError(res, applicationId, toast)) return
      // 402 = the one-time form fee for this visa is unpaid: open its checkout
      // instead of the generic "Failed to create session".
      if (await handlePaymentRequired(res, applicationId, toast)) return
      if (!res.ok) throw new Error(t('errCreateSession'))
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
      const handed = await sendToExtension<{ ok?: boolean; detail?: string }>({
        type: 'session',
        token: data.token,
        apiUrl,
        portalUrl: portalUrl.trim() || undefined,
        readbackToken: decision.readbackToken,
      })
      if (!handed?.ok) {
        throw new Error(handed?.detail ?? t('errExtReject'))
      }
      setHandedOff(true)
    } catch (err) {
      console.error('[VisaAI] launchSession failed:', err)
      setError(err instanceof Error ? err.message : t('errLaunch'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!sessionId) return
    let cancelled = false

    async function poll() {
      try {
        const { data: { session } } = await getSession()
        if (!session || cancelled || !sessionId) return
        const res = await fetch(`${apiUrl}/automation/session/${sessionId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!res.ok || cancelled) return
        const data = await res.json() as { status: SessionStatus }
        if (!cancelled) setStatus(data.status)
        if (data.status === 'complete' || data.status === 'error') {
          if (pollRef.current) clearInterval(pollRef.current)
        }
      } catch {
        // Network blip or API unreachable — keep polling on next interval tick.
      }
    }

    void poll()
    pollRef.current = setInterval(poll, 2000)
    return () => {
      cancelled = true
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [sessionId, apiUrl])

  return (
    <div style={{ maxWidth: 720 }}>
      <header className="page-head">
        <div className="page-head__intro">
          <span className="eyebrow">{t('eyebrow')}</span>
          <h1 className="type-h1" style={{ margin: '0 auto 44px' }}>{t('title')}</h1>
          <p className="lede">
            {t('lede')}
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

      {extState === 'installed' && (
        <Card variant="tight" className="mb-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="type-h3" style={{ margin: '0 auto 10px' }}>{t('extReady')}</p>
              <p className="sans" style={{ fontSize: '0.88rem', marginTop: 4, color: 'var(--color-midtone-gray)' }}>
                {t('extReadyBody')}
              </p>
            </div>
            <Badge variant="emerald">{t('installed')}</Badge>
          </div>
        </Card>
      )}

      {handedOff && status !== 'active' && status !== 'complete' && (
        <Card variant="tight" className="mb-4" style={{ borderColor: 'var(--color-success-green, #10c22b)' }}>
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="type-h3">{t('sessionSent')}</p>
            <Badge variant="emerald">GO</Badge>
          </div>
          <p className="sans" style={{ fontSize: '0.92rem', lineHeight: 1.6 }}>
            Click the <span className="font-medium">VisaAI</span> icon in your Chrome toolbar
            (top-right, next to the address bar — you may need to click the puzzle icon first
            and pin it). The side panel will open and start filling automatically.
          </p>
        </Card>
      )}

      {error && <div className="alert alert-error mb-4" role="alert">{error}</div>}

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
          {destinationCountry === 'CA' && (
            <p className="sans" style={{ fontSize: '0.88rem', marginTop: 8 }}>
              That filled the IRCC page that was open. Answer anything left blank, press
              <strong> Save and continue</strong> on IRCC, and launch the assistant again on
              the next page — the side panel names the next page it has values for.
            </p>
          )}
        </Card>
      )}

      {!canLaunch && (
        <Card variant="tight" className="mb-4">
          <p className="type-h3" style={{ marginBottom: 8 }}>Only the applicant can launch the portal assistant</p>
          <p className="sans" style={{ fontSize: '0.88rem', lineHeight: 1.6 }}>
            Auto-fill runs in the applicant&apos;s own browser, signed in to their own
            government portal account, after they confirm the values below. You can
            see where things stand here; the applicant launches it from their account.
          </p>
        </Card>
      )}

      {canLaunch && destinationCountry === 'CA' && <IrccSessionTips />}

      {canLaunch && (
      <Card variant="tight" className="mb-4">
        <label className="eyebrow" style={{ display: 'block', marginBottom: 8 }} htmlFor="portalUrl">
          {t('portalUrlLabel')}
        </label>
        <input
          id="portalUrl"
          type="url"
          value={portalUrl}
          onChange={(e) => setPortalUrl(e.target.value)}
          placeholder="https://onlineservices-servicesenligne.cic.gc.ca/…"
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
      <ReadbackGate applicationId={applicationId} onChange={setReadback} readOnly={!canLaunch} />

      {!canLaunch ? null : extState === 'installed' || extState === 'checking' ? (
        <Button
          onClick={handleLaunch}
          disabled={loading || extState !== 'installed' || !readback.confirmed}
          size="lg"
        >
          {loading
            ? t('launching')
            : extState === 'installed'
              ? t('launchAssistant')
              : t('checkingExt')}
        </Button>
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
