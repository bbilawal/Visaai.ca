/**
 * Submit page — who may launch, and what the applicant is told.
 *
 * Dry run 2026-10-14:
 *  #49 a consultant opened the applicant's Submit page and pressed Launch; the
 *      API 403'd and the page showed a generic error. Non-owners now get a
 *      read-only explanation and no Launch button (the API 403 stays).
 *  #52 the IRCC session expired (~20 min idle) while the applicant went back
 *      and forth to VisaAI, and the unsaved IRCC page was lost with no
 *      guidance. The page now says how to avoid and recover from that.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ApiError } from '@/lib/api/client'
import { CA_ETA_VISAAI_ID, CA_WORK_VISAAI_ID, routeHasPortalFill } from '@visaai/types'

const requestExecution = vi.fn()
const startFormFeeCheckout = vi.fn()

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vals?: Record<string, string>) =>
    vals ? `${key}: ${Object.values(vals).join(' ')}` : key,
}))
vi.mock('@/components/providers/toast-provider', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/components/required-docs-gate', () => ({
  useRequiredDocsReady: () => ({ ready: true, missing: [] }),
  MissingDocsPanel: () => null,
}))
vi.mock('@/components/outcome-reporter', () => ({ OutcomeReporter: () => null }))
vi.mock('@/lib/use-supported-countries', () => ({
  useSupportedCountries: () => ({ countries: [{ code: 'CA', assistedFill: true }] }),
}))
vi.mock('@/lib/extension-ids', () => ({
  CHROME_WEB_STORE_URL: 'https://store',
  extensionIdCandidates: () => ['ext-1'],
  findInstalledExtension: async () => 'ext-1',
}))
/** Who the browser is signed in as (tests switch accounts). */
const signedIn = { id: 'owner-1' }
const refreshSession = vi.fn(async () => ({ data: { session: null } }))
vi.mock('@/lib/supabase/client', () => ({
  getSession: async () => ({ data: { session: { access_token: 't', user: { id: signedIn.id } } } }),
  refreshSession: () => refreshSession(),
}))
vi.mock('@/lib/plan-error', () => ({ handlePlanError: async () => false }))
vi.mock('@/lib/payment-error', () => ({
  startFormFeeCheckout: (...a: unknown[]) => startFormFeeCheckout(...a),
}))
vi.mock('@/lib/api/execution-client', () => ({
  requestExecution: (...a: unknown[]) => requestExecution(...a),
}))
// The gate has its own tests; here it reports a confirmed, locked review.
vi.mock('./readback-gate', async () => {
  const React = await import('react')
  function GateStub({ readOnly, onChange }: { readOnly?: boolean; onChange: (s: unknown) => void }) {
    React.useEffect(() => {
      onChange({
        confirmed: !readOnly,
        reviewId: 'r1',
        mappings: [{ fieldKey: 'given_name', targetField: '#g', mappedValue: 'Ada', category: 'passport' }],
        fillable: true,
      })
    }, [readOnly, onChange])
    return <div data-testid="gate" data-readonly={String(Boolean(readOnly))} />
  }
  return { default: GateStub }
})

import SubmissionClient from './submission-client'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

/**
 * Route the page's two API calls: GET /prefill/:id (is the form fee paid?)
 * and POST /automation/:id/session (Launch). Either may be a Response or a
 * thrown error (network failure).
 */
function routeFetch(opts: { prefill?: Response | Error; session?: Response | Error }) {
  const fn = vi.fn(async (url: string) => {
    const r = String(url).includes('/prefill/') ? opts.prefill : opts.session
    if (r instanceof Error) throw r
    return r ?? json({ message: 'nope' }, 404)
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
const sessionCalls = (fn: ReturnType<typeof routeFetch>) =>
  fn.mock.calls.filter(([u]) => String(u).includes('/automation/'))

describe('SubmissionClient', () => {
  beforeEach(() => {
    requestExecution.mockReset()
    startFormFeeCheckout.mockReset()
    ;(window as unknown as { chrome: unknown }).chrome = {
      runtime: { sendMessage: (_id: string, _m: unknown, cb: (r: unknown) => void) => cb({ ok: true }) },
    }
  })
  afterEach(() => {
    delete (window as unknown as { chrome?: unknown }).chrome
    vi.unstubAllGlobals()
  })

  it('a non-owner (consultant) gets a read-only explanation and no Launch button', async () => {
    render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch={false} />)
    expect(await screen.findByText(/Only the applicant can launch the portal assistant/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'launchAssistant' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'checkingExt' })).not.toBeInTheDocument()
    expect(screen.getByTestId('gate').dataset.readonly).toBe('true')
  })

  it('the applicant gets the Launch button', async () => {
    render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch />)
    expect(await screen.findByRole('button', { name: 'launchAssistant' })).toBeEnabled()
    expect(screen.getByTestId('gate').dataset.readonly).toBe('false')
  })

  it('tells the applicant how to survive an IRCC session timeout', () => {
    render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch />)
    const tips = screen.getByRole('region', { name: /Before you start on the IRCC portal/ })
    expect(tips.textContent).toMatch(/Save each IRCC page/)
    expect(tips.textContent).toMatch(/sign in again/)
    expect(tips.textContent).toMatch(/Continue/)
    expect(tips.textContent).toMatch(/each IRCC page/i)
  })

  // 2026-10-19: an Express Entry application launched tr-rt's visitor-visa fill.
  it('an Express Entry application gets the manual route: no Launch, no IRCC tips', async () => {
    render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch routeAssistedFill={false} />)
    expect(screen.getByRole('region', { name: 'extUnsupportedRouteTitle' })).toBeInTheDocument()
    expect(screen.getByText('extUnsupportedRouteBody')).toBeInTheDocument()
    // The header must not say the extension fills the portal.
    expect(screen.getByText('ledeManual')).toBeInTheDocument()
    expect(screen.queryByText('lede')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('extReadyBody')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'launchAssistant' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /Before you start on the IRCC portal/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('portalUrlLabel')).not.toBeInTheDocument()
  })

  // 2026-10-30: the work permit fills the IRCC secure account's questionnaire
  // (its Work branch), so Submit shows Launch, not the manual route.
  it('a work permit gets the Launch path, not the manual route', async () => {
    render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch routeAssistedFill={routeHasPortalFill(CA_WORK_VISAAI_ID)} visaaiId={CA_WORK_VISAAI_ID} />)
    expect(await screen.findByRole('button', { name: 'launchAssistant' })).toBeEnabled()
    expect(screen.queryByRole('region', { name: 'extUnsupportedRouteTitle' })).not.toBeInTheDocument()
    expect(screen.queryByText('extUnsupportedRouteBody')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: /Before you start on the IRCC portal/ })).toBeInTheDocument()
  })

  // Dry run 2026-10-18: the eTA has no IRCC account, one page, and a Next button.
  it('an eTA application gets eTA tips, not the IRCC sign-in / Save and continue ones', async () => {
    render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch isEta />)
    const tips = screen.getByRole('region', { name: /Before you start on the eTA form/ })
    expect(tips.textContent).toMatch(/Next/)
    expect(tips.textContent).toMatch(/Fill newly shown questions/)
    expect(screen.queryByRole('region', { name: /Before you start on the IRCC portal/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Save and continue/)).not.toBeInTheDocument()
    expect(await screen.findByText('extReadyBodyEta')).toBeInTheDocument()
  })

  it('a 403 on launch says only the applicant can launch, not "Failed to create session"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'Access denied' }), { status: 403 })))
    render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch />)
    fireEvent.click(await screen.findByRole('button', { name: 'launchAssistant' }))
    expect((await screen.findByRole('alert')).textContent).toBe('errNotOwner')
  })

  it('refuses before calling the API when the browser is now signed in as someone else', async () => {
    const fetchMock = routeFetch({})
    // Rendered for the applicant; the session now belongs to another user (account switch in the same browser).
    render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch ownerId="someone-else" />)
    fireEvent.click(await screen.findByRole('button', { name: 'launchAssistant' }))
    expect((await screen.findByRole('alert')).textContent).toBe('errNotOwner')
    expect(sessionCalls(fetchMock)).toHaveLength(0)
  })

  it('the applicant (session matches ownerId) still launches', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: 'Access denied' }), { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch ownerId="owner-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'launchAssistant' }))
    await screen.findByRole('alert')
    expect(fetchMock).toHaveBeenCalled()
  })

  it('explains a blocked fill in words, not codes (consultant_missing)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ sessionId: 's1', token: 'tok' }), { status: 200 })))
    requestExecution.mockResolvedValue({ allowed: false, blockedReasons: ['consultant_missing'], evaluationDetails: null })
    render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch />)
    fireEvent.click(await screen.findByRole('button', { name: 'launchAssistant' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Approve application/)
    expect(alert.textContent).not.toMatch(/consultant_missing/)
  })

  // ── Dry run 2026-10-18 ────────────────────────────────────────────────────

  it('says before launch how to open the side panel afterwards', async () => {
    routeFetch({ prefill: json({ paid: true }) })
    render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch />)
    expect(await screen.findByText('launchHint')).toBeInTheDocument()
  })

  it('after a successful launch, shows the numbered next steps (switch tab, click the toolbar icon)', async () => {
    routeFetch({ prefill: json({ paid: true }), session: json({ sessionId: 's1', token: 'tok' }) })
    requestExecution.mockResolvedValue({ allowed: true, readbackToken: 'rb', blockedReasons: [] })
    render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch />)
    fireEvent.click(await screen.findByRole('button', { name: 'launchAssistant' }))
    const steps = await screen.findByRole('status', { name: 'nextStepsTitle' })
    const items = steps.querySelectorAll('ol > li')
    expect([...items].map(li => li.textContent)).toEqual(['nextStep1', 'nextStep2'])
    expect(steps).toHaveFocus()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('an eTA launch gets the eTA wording of the next steps', async () => {
    routeFetch({ prefill: json({ paid: true }), session: json({ sessionId: 's1', token: 'tok' }) })
    requestExecution.mockResolvedValue({ allowed: true, readbackToken: 'rb', blockedReasons: [] })
    render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch isEta />)
    fireEvent.click(await screen.findByRole('button', { name: 'launchAssistant' }))
    const steps = await screen.findByRole('status', { name: 'nextStepsTitleEta' })
    expect(steps.textContent).toMatch(/nextStep1Eta/)
    expect(steps.textContent).toMatch(/nextStep2Eta/)
  })

  it('an unpaid form fee is shown before launch, and the button says it opens payment', async () => {
    const fetchMock = routeFetch({ prefill: json({ paid: false }), session: json({ message: 'Pay' }, 402) })
    render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch />)
    const notice = await screen.findByRole('region', { name: 'feeUnpaidTitle: $29' })
    expect(notice.textContent).toMatch(/feeUnpaidBody/)
    const btn = screen.getByRole('button', { name: 'launchPayFee' })
    // The user was told: the click goes to checkout without a second prompt.
    fireEvent.click(btn)
    await waitFor(() => expect(startFormFeeCheckout).toHaveBeenCalledWith('app-1', expect.any(Function)))
    expect(sessionCalls(fetchMock)).toHaveLength(1)
  })

  // Owner decision 2026-10-18: the eTA form fee is $10, every other visa $29.
  it('an eTA application shows the $10 form fee and says the IRCC eTA fee is separate', async () => {
    routeFetch({ prefill: json({ paid: false }) })
    render(
      <SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch isEta visaaiId={CA_ETA_VISAAI_ID} />,
    )
    const notice = await screen.findByRole('region', { name: 'feeUnpaidTitle: $10' })
    expect(notice.textContent).toMatch(/feeEtaIrccNote/)
    expect(screen.queryByRole('region', { name: 'feeUnpaidTitle: $29' })).not.toBeInTheDocument()
  })

  it('a non-eTA visa type shows the $29 fee and no IRCC eTA note', async () => {
    routeFetch({ prefill: json({ paid: false }) })
    render(
      <SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch visaaiId="ca-visitor-visa-trv" />,
    )
    const notice = await screen.findByRole('region', { name: 'feeUnpaidTitle: $29' })
    expect(notice.textContent).not.toMatch(/feeEtaIrccNote/)
  })

  it('the eTA fee prompt on an unexpected 402 quotes $10', async () => {
    routeFetch({ prefill: json({}, 500), session: json({ message: 'Pay' }, 402) })
    render(
      <SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch isEta visaaiId={CA_ETA_VISAAI_ID} />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'launchAssistant' }))
    const prompt = await screen.findByRole('alert')
    expect(prompt.textContent).toMatch(/feePromptBody: \$10/)
    expect(prompt.textContent).toMatch(/feeEtaIrccNote/)
  })

  it('an unexpected 402 asks before opening checkout instead of redirecting', async () => {
    // Paid status unknown (the prefill read failed), so the page could not warn.
    routeFetch({ prefill: json({}, 500), session: json({ message: 'Pay' }, 402) })
    render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch />)
    fireEvent.click(await screen.findByRole('button', { name: 'launchAssistant' }))
    const prompt = await screen.findByRole('alert')
    expect(prompt.textContent).toMatch(/feePromptBody: \$29/)
    expect(startFormFeeCheckout).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'continueToPayment' }))
    await waitFor(() => expect(startFormFeeCheckout).toHaveBeenCalledWith('app-1', expect.any(Function)))
  })

  it('"Not now" dismisses the fee prompt without opening checkout', async () => {
    routeFetch({ prefill: json({}, 500), session: json({ message: 'Pay' }, 402) })
    render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch />)
    fireEvent.click(await screen.findByRole('button', { name: 'launchAssistant' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'notNow' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(startFormFeeCheckout).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'launchPayFee' })).toBeEnabled()
  })

  it.each([
    ['a network error', new TypeError('Failed to fetch')],
    ['a 502', json({}, 502)],
    ['a 503', json({}, 503)],
  ])('%s during a deploy restart says VisaAI is restarting and keeps Launch enabled', async (_label, session) => {
    routeFetch({ prefill: json({ paid: true }), session })
    render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch />)
    fireEvent.click(await screen.findByRole('button', { name: 'launchAssistant' }))
    expect((await screen.findByRole('alert')).textContent).toBe('errRestarting')
    expect(screen.getByRole('button', { name: 'launchAssistant' })).toBeEnabled()
  })

  it('a 502 from the execution gate also reads as a restart', async () => {
    routeFetch({ prefill: json({ paid: true }), session: json({ sessionId: 's1', token: 'tok' }) })
    requestExecution.mockRejectedValue(new ApiError(502, 'POST /execution/request -> 502'))
    render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch />)
    fireEvent.click(await screen.findByRole('button', { name: 'launchAssistant' }))
    expect((await screen.findByRole('alert')).textContent).toBe('errRestarting')
  })

  // ── Dry run 2026-10-18, second pass: Launch succeeded, the page showed nothing ──
  describe('session hand-off, with the replies the real extension sends', () => {
    type Reply = unknown | 'lastError' | 'never'
    /**
     * Mirrors apps/extension/src/background.ts onMessageExternal: 'ping'
     * answers synchronously; 'open-panel' and 'session' answer later (after
     * chrome.sidePanel.open / chrome.storage + badge + tab switch). Launch
     * sends 'open-panel' first and does not wait for it; Chrome refuses the
     * panel when the click's gesture is gone, so it answers { ok: false }.
     */
    function installExtension(session: Reply | Reply[], openPanel: unknown = { ok: false, detail: 'gesture' }) {
      const sent: Array<{ type?: string }> = []
      // One reply per 'session' message, in turn (the last one repeats).
      const sessionReplies = Array.isArray(session) ? session : [session]
      let sessionCount = 0
      const runtime: { lastError?: { message: string }; sendMessage: unknown } = {
        sendMessage: (_id: string, m: { type?: string }, cb: (r: unknown) => void) => {
          sent.push(m)
          if (m.type === 'ping') return cb({ ok: true, version: '1.4.0' })
          const reply =
            m.type === 'open-panel'
              ? openPanel
              : m.type === 'session'
                ? sessionReplies[Math.min(sessionCount++, sessionReplies.length - 1)]
                : { ok: false, detail: 'unknown message type' }
          if (reply === 'never') return
          setTimeout(() => {
            if (reply === 'lastError') {
              runtime.lastError = { message: 'The message port closed before a response was received.' }
              cb(undefined)
              delete runtime.lastError
              return
            }
            cb(reply)
          }, 5)
        },
      }
      ;(window as unknown as { chrome: unknown }).chrome = { runtime }
      return sent
    }

    /** Prefill paid; session created; the status poll answers `statuses` in turn. */
    function launchableApi(statuses: string[] = ['pending']) {
      let i = 0
      vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url)
        if (u.includes('/prefill/')) return json({ paid: true })
        if (u.includes('/automation/session/')) return json({ status: statuses[Math.min(i++, statuses.length - 1)] })
        if (u.includes('/automation/') && init?.method === 'POST') return json({ sessionId: 's1', token: 'tok' }, 201)
        return json({ message: 'nope' }, 404)
      }))
      requestExecution.mockResolvedValue({ allowed: true, readbackToken: 'rb', blockedReasons: [] })
    }

    it('{ ok: true } from the extension shows the Next card right above Launch, even when open-panel was refused', async () => {
      const sent = installExtension({ ok: true })
      launchableApi()
      render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch />)
      fireEvent.click(await screen.findByRole('button', { name: 'launchAssistant' }))
      const steps = await screen.findByRole('status', { name: 'nextStepsTitle' })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      // (Detection is mocked here, so no ping.)
      expect(sent.map(m => m.type)).toEqual(['open-panel', 'session'])
      // Where the applicant is looking: after the readback table, before the button.
      const gate = screen.getByTestId('gate')
      const launch = screen.getByRole('button', { name: 'launchAssistant' })
      expect(gate.compareDocumentPosition(steps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(steps.compareDocumentPosition(launch) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('the Next card stays once the side panel connects and the session goes active', async () => {
      installExtension({ ok: true })
      launchableApi(['active'])
      render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch />)
      fireEvent.click(await screen.findByRole('button', { name: 'launchAssistant' }))
      await screen.findByText('fillingProgress')
      expect(await screen.findByRole('status', { name: 'nextStepsTitle' })).toBeInTheDocument()
      // And still there on later polls, with the session active.
      await new Promise(r => setTimeout(r, 50))
      expect(screen.getByText('fillingProgress')).toBeInTheDocument()
      expect(screen.getByRole('status', { name: 'nextStepsTitle' })).toBeInTheDocument()
    })

    it('a session that ends in error drops the GO prompt and says the assistant stopped', async () => {
      installExtension({ ok: true })
      launchableApi(['error'])
      render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch />)
      fireEvent.click(await screen.findByRole('button', { name: 'launchAssistant' }))
      expect((await screen.findByRole('alert')).textContent).toBe('errSessionStopped')
      // Wait for the hand-off to finish too (the poll can answer first).
      expect(await screen.findByRole('button', { name: 'launchAssistant' })).toBeEnabled()
      expect(screen.queryByRole('status', { name: 'nextStepsTitle' })).not.toBeInTheDocument()
      expect(screen.getByRole('alert').textContent).toBe('errSessionStopped')
    })

    it('switching to another application drops the last launch’s card and status', async () => {
      installExtension({ ok: true })
      launchableApi(['active'])
      const { rerender } = render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch />)
      fireEvent.click(await screen.findByRole('button', { name: 'launchAssistant' }))
      await screen.findByRole('status', { name: 'nextStepsTitle' })
      await screen.findByText('fillingProgress')
      rerender(<SubmissionClient applicationId="app-2" destinationCountry="CA" canLaunch />)
      expect(screen.queryByRole('status', { name: 'nextStepsTitle' })).not.toBeInTheDocument()
      expect(screen.queryByText('fillingProgress')).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    // Live 2026-10-20: the applicant's Submit tab polled with the
    // consultant's token after the browser switched accounts: 155 refusals.
    it('a 403 on the status poll stops polling and says only the applicant can launch', async () => {
      installExtension({ ok: true })
      let polls = 0
      vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url)
        if (u.includes('/prefill/')) return json({ paid: true })
        if (u.includes('/automation/session/')) {
          polls++
          return json({ message: 'Access denied' }, 403)
        }
        if (u.includes('/automation/') && init?.method === 'POST') return json({ sessionId: 's1', token: 'tok' }, 201)
        return json({ message: 'nope' }, 404)
      }))
      requestExecution.mockResolvedValue({ allowed: true, readbackToken: 'rb', blockedReasons: [] })
      render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch />)
      fireEvent.click(await screen.findByRole('button', { name: 'launchAssistant' }))
      await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('errNotOwner'))
      const after = polls
      await new Promise(r => setTimeout(r, 2300))
      expect(polls).toBe(after)
    })

    describe('the status poll (review of b196f0c0)', () => {
      function pollApi(statuses: number[]) {
        let i = 0
        const calls = { polls: 0 }
        vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
          const u = String(url)
          if (u.includes('/prefill/')) return json({ paid: true })
          if (u.includes('/automation/session/')) {
            calls.polls++
            const code = statuses[Math.min(i++, statuses.length - 1)]
            return code === 200 ? json({ status: 'pending' }) : json({ message: 'x' }, code)
          }
          if (u.includes('/automation/') && init?.method === 'POST') return json({ sessionId: 's1', token: 'tok' }, 201)
          return json({ message: 'nope' }, 404)
        }))
        requestExecution.mockResolvedValue({ allowed: true, readbackToken: 'rb', blockedReasons: [] })
        return calls
      }
      beforeEach(() => {
        signedIn.id = 'owner-1'
        refreshSession.mockClear()
      })

      it('a 403 for the signed-in owner is transient: no "not the applicant" error, polling continues', async () => {
        installExtension({ ok: true })
        const calls = pollApi([403, 200])
        render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch ownerId="owner-1" />)
        fireEvent.click(await screen.findByRole('button', { name: 'launchAssistant' }))
        await screen.findByRole('status', { name: 'nextStepsTitle' })
        await waitFor(() => expect(calls.polls).toBeGreaterThanOrEqual(2), { timeout: 5000 })
        expect(screen.queryByText('errNotOwner')).not.toBeInTheDocument()
      })

      it('a 401 refreshes the session once and keeps polling', async () => {
        installExtension({ ok: true })
        const calls = pollApi([401, 401, 200])
        render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch ownerId="owner-1" />)
        fireEvent.click(await screen.findByRole('button', { name: 'launchAssistant' }))
        await waitFor(() => expect(calls.polls).toBeGreaterThanOrEqual(2), { timeout: 5000 })
        expect(refreshSession).toHaveBeenCalledTimes(1)
        expect(screen.queryByText('errNotOwner')).not.toBeInTheDocument()
      })

      it('another account signed in: stops, then restarts on focus once the applicant is back', async () => {
        installExtension({ ok: true })
        const calls = pollApi([200])
        render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch ownerId="owner-1" />)
        fireEvent.click(await screen.findByRole('button', { name: 'launchAssistant' }))
        await screen.findByRole('status', { name: 'nextStepsTitle' })
        await waitFor(() => expect(calls.polls).toBeGreaterThanOrEqual(1))
        signedIn.id = 'consultant-9'
        expect(await screen.findByText('errNotOwner', {}, { timeout: 4000 })).toBeInTheDocument()
        const stopped = calls.polls
        await new Promise(r => setTimeout(r, 2200))
        expect(calls.polls).toBe(stopped)
        signedIn.id = 'owner-1'
        fireEvent.focus(window)
        await waitFor(() => expect(calls.polls).toBeGreaterThan(stopped))
        await waitFor(() => expect(screen.queryByText('errNotOwner')).not.toBeInTheDocument())
      }, 15000)
    })

    it('a refusal names the reason the extension gave', async () => {
      installExtension({ ok: false, detail: 'untrusted apiUrl' })
      launchableApi()
      render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch />)
      fireEvent.click(await screen.findByRole('button', { name: 'launchAssistant' }))
      expect((await screen.findByRole('alert')).textContent).toBe('errExtRejectDetail: untrusted apiUrl')
      expect(screen.queryByRole('status', { name: 'nextStepsTitle' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'launchAssistant' })).toBeEnabled()
    })

    it('a closed message port (no reply), twice: retried once, then says to reload the page', async () => {
      const sent = installExtension('lastError')
      launchableApi()
      render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch />)
      fireEvent.click(await screen.findByRole('button', { name: 'launchAssistant' }))
      expect((await screen.findByRole('alert')).textContent).toBe('errExtHandoffFailed')
      expect(sent.filter(m => m.type === 'session')).toHaveLength(2)
    })

    // Live 2026-10-21: after the extension was reloaded, the first Launch
    // reached nothing and a second click worked. Now the page retries once.
    it('a first hand-off that gets no answer is retried once, and the retry succeeds', async () => {
      const sent = installExtension(['lastError', { ok: true }])
      launchableApi()
      render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch />)
      fireEvent.click(await screen.findByRole('button', { name: 'launchAssistant' }))
      expect(await screen.findByRole('status', { name: 'nextStepsTitle' })).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(sent.filter(m => m.type === 'session')).toHaveLength(2)
    })

    it('no reply at all times out with an error instead of spinning forever', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        installExtension('never')
        launchableApi()
        render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch />)
        fireEvent.click(await screen.findByRole('button', { name: 'launchAssistant' }))
        await screen.findByRole('button', { name: 'launching' })
        // The short first try, then the retry's full wait.
        await vi.advanceTimersByTimeAsync(5_000)
        await vi.advanceTimersByTimeAsync(15_000)
        expect((await screen.findByRole('alert')).textContent).toBe('errExtHandoffFailed')
        expect(screen.getByRole('button', { name: 'launchAssistant' })).toBeEnabled()
      } finally {
        vi.useRealTimers()
      }
    })
  })

  it('a 500 is not mistaken for a restart', async () => {
    routeFetch({ prefill: json({ paid: true }), session: json({}, 500) })
    render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch />)
    fireEvent.click(await screen.findByRole('button', { name: 'launchAssistant' }))
    expect((await screen.findByRole('alert')).textContent).toBe('errCreateSession')
  })
})
