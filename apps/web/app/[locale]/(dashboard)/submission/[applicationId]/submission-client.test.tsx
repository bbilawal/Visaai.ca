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
import { render, screen, fireEvent } from '@testing-library/react'

const requestExecution = vi.fn()

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vals?: Record<string, string>) =>
    vals?.reasons ? `${key}: ${vals.reasons}` : key,
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
vi.mock('@/lib/supabase/client', () => ({
  getSession: async () => ({ data: { session: { access_token: 't' } } }),
}))
vi.mock('@/lib/plan-error', () => ({ handlePlanError: async () => false }))
vi.mock('@/lib/payment-error', () => ({ handlePaymentRequired: async () => false }))
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

describe('SubmissionClient', () => {
  beforeEach(() => {
    requestExecution.mockReset()
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

  it('explains a blocked fill in words, not codes (consultant_missing)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ sessionId: 's1', token: 'tok' }), { status: 200 })))
    requestExecution.mockResolvedValue({ allowed: false, blockedReasons: ['consultant_missing'], evaluationDetails: null })
    render(<SubmissionClient applicationId="app-1" destinationCountry="CA" canLaunch />)
    fireEvent.click(await screen.findByRole('button', { name: 'launchAssistant' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Approve application/)
    expect(alert.textContent).not.toMatch(/consultant_missing/)
  })
})
