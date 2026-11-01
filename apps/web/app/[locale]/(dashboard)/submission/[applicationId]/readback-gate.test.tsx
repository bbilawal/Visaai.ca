/**
 * The readback gate must never be a dead end.
 *
 * 2026-10-13 it sat on "Checking the pre-submission review…" indefinitely
 * because getSession() never settled. getSession() is now bounded and rejects
 * instead (lib/supabase/client.ts), which lands here as an error — so the error
 * has to offer a way forward without a full page reload.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

const getSession = vi.fn()
const getPreflightMappings = vi.fn()
const getActivePreflight = vi.fn()
const validatePreflightLock = vi.fn()
const getConsultantApproval = vi.fn()
const getPortalFillCoverage = vi.fn()

vi.mock('@/lib/supabase/client', () => ({ getSession: () => getSession() }))
vi.mock('@/lib/api/preflight-client', () => ({
  getPreflightMappings: (...a: unknown[]) => getPreflightMappings(...a),
  getActivePreflight: (...a: unknown[]) => getActivePreflight(...a),
  validatePreflightLock: (...a: unknown[]) => validatePreflightLock(...a),
  getPortalFillCoverage: (...a: unknown[]) => getPortalFillCoverage(...a),
}))

vi.mock('@/lib/api/consultant-client', () => ({
  getConsultantApproval: (...a: unknown[]) => getConsultantApproval(...a),
}))

import ReadbackGate from './readback-gate'

const APPROVED = { applicationId: 'app-1', fields: [], sections: [], applicationApproved: true }

describe('ReadbackGate when the review cannot be loaded', () => {
  beforeEach(() => {
    getSession.mockReset()
    getPreflightMappings.mockReset()
    getActivePreflight.mockReset()
    validatePreflightLock.mockReset().mockResolvedValue({ valid: true, reasons: [] })
    getConsultantApproval.mockReset().mockResolvedValue(APPROVED)
  })

  it('shows the error with a retry that reloads the review', async () => {
    getSession.mockRejectedValueOnce(
      new Error('Could not reach the sign-in service. Check your connection and try again.'),
    )
    render(<ReadbackGate applicationId="app-1" onChange={() => {}} />)

    expect(await screen.findByText(/Could not reach the sign-in service/)).toBeInTheDocument()

    getSession.mockResolvedValueOnce({ data: { session: { access_token: 't' } } })
    getPreflightMappings.mockResolvedValueOnce([
      { fieldKey: 'given_name', mappedValue: 'Ada' },
    ])
    getActivePreflight.mockResolvedValueOnce({
      id: 'r1',
      status: 'completed',
      locked_diff_hash: 'h',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Confirm what will be entered')).toBeInTheDocument()
    expect(screen.queryByText(/Could not reach the sign-in service/)).not.toBeInTheDocument()
    expect(getPreflightMappings).toHaveBeenCalledWith('t', 'app-1')
  })

  // Dry run 2026-10-18: during a deploy restart the gate printed
  // "GET /preflight/... -> 502".
  it('says VisaAI is restarting when the API answers 502', async () => {
    const { ApiError } = await import('@/lib/api/client')
    getSession.mockResolvedValueOnce({ data: { session: { access_token: 't' } } })
    getPreflightMappings.mockRejectedValueOnce(new ApiError(502, 'GET /preflight/app-1/mappings -> 502'))
    getActivePreflight.mockResolvedValueOnce(null)
    render(<ReadbackGate applicationId="app-1" onChange={() => {}} />)

    expect(await screen.findByText(/VisaAI is restarting/)).toBeInTheDocument()
    expect(screen.queryByText(/-> 502/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
  })
})

/**
 * An applicant edit on the Forms page after the consultant locked the review
 * changes a mapped value, which breaks the lock hash. Before this, the gate
 * still said "Confirm what will be entered" and let the applicant tick — the
 * execution request then failed with lock_changed and no explanation.
 */
describe('ReadbackGate when the lock was broken by a later change', () => {
  beforeEach(() => {
    getSession.mockReset().mockResolvedValue({ data: { session: { access_token: 't' } } })
    getPreflightMappings.mockReset().mockResolvedValue([
      { fieldKey: 'duration_of_stay_days', mappedValue: '70' },
    ])
    getActivePreflight.mockReset().mockResolvedValue({ id: 'r1', status: 'completed', locked_diff_hash: 'h' })
    validatePreflightLock.mockReset()
    getConsultantApproval.mockReset().mockResolvedValue(APPROVED)
  })

  it('says the review needs re-review (without blaming any one page) and offers no confirmation', async () => {
    validatePreflightLock.mockResolvedValue({ valid: false, reasons: ['provenance_or_mapping_changed'] })
    const onChange = vi.fn()
    render(<ReadbackGate applicationId="app-1" onChange={onChange} />)

    const msg = await screen.findByText(/needs your consultant to review it again/i)
    expect(msg).toBeInTheDocument()
    expect(msg.textContent).not.toMatch(/Forms page/)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(validatePreflightLock).toHaveBeenCalledWith('t', 'app-1', 'r1', [
      { fieldKey: 'duration_of_stay_days', mappedValue: '70' },
    ])
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ confirmed: true }))
  })

  it('still offers confirmation when the lock holds', async () => {
    validatePreflightLock.mockResolvedValue({ valid: true, reasons: [] })
    render(<ReadbackGate applicationId="app-1" onChange={() => {}} />)
    expect(await screen.findByText('Confirm what will be entered')).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeInTheDocument()
  })

  // Dry run 2026-10-18: the eTA is one page — nothing fills "as you open" it.
  it('on the eTA tells the applicant to press Next, then "Fill newly shown questions"', async () => {
    validatePreflightLock.mockResolvedValue({ valid: true, reasons: [] })
    render(<ReadbackGate applicationId="app-1" onChange={() => {}} isEta />)
    expect(await screen.findByText(/Fill newly shown questions/)).toBeInTheDocument()
    expect(screen.queryByText(/Save and continue/)).not.toBeInTheDocument()
  })
})

/**
 * Dry run 2026-10-14: the gate said only "Awaiting consultant review" whatever
 * the reason. The real blocker that day was consultant_missing — the consultant
 * had locked the review but never pressed "Approve application" — and the
 * applicant had no way to know that.
 */
describe('ReadbackGate explains exactly what is blocking auto-fill', () => {
  beforeEach(() => {
    getSession.mockReset().mockResolvedValue({ data: { session: { access_token: 't' } } })
    getPreflightMappings.mockReset().mockResolvedValue([
      { fieldKey: 'given_name', targetField: '#g', mappedValue: 'Ada' },
    ])
    getActivePreflight.mockReset().mockResolvedValue({ id: 'r1', status: 'completed', locked_diff_hash: 'h' })
    validatePreflightLock.mockReset().mockResolvedValue({ valid: true, reasons: [] })
    getConsultantApproval.mockReset().mockResolvedValue(APPROVED)
  })

  it('locked but not approved: says the consultant must press Approve application', async () => {
    getConsultantApproval.mockResolvedValue({ ...APPROVED, applicationApproved: false })
    const onChange = vi.fn()
    render(<ReadbackGate applicationId="app-1" onChange={onChange} />)
    expect(await screen.findByText(/Approve application/)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ confirmed: true }))
  })

  it('approval older than the current lock: asks the consultant to lock and approve again (live 2026-10-19)', async () => {
    getConsultantApproval.mockResolvedValue({ ...APPROVED, applicationApproved: false, applicationApprovalStale: true })
    const onChange = vi.fn()
    render(<ReadbackGate applicationId="app-1" onChange={onChange} />)
    expect(await screen.findByText(/lock the new review and approve it again/)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ confirmed: true }))
  })

  it('names a rejected field instead of the generic approval text', async () => {
    getConsultantApproval.mockResolvedValue({
      ...APPROVED,
      applicationApproved: false,
      fields: [{ fieldKey: 'sponsor_occupation', decision: 'rejected', approved: false, stale: false, approvedValueHash: null }],
    })
    render(<ReadbackGate applicationId="app-1" onChange={() => {}} />)
    expect(await screen.findByText(/rejected a field \(sponsor_occupation\)/)).toBeInTheDocument()
  })

  it('maps each lock reason to its own text', async () => {
    validatePreflightLock.mockResolvedValue({ valid: false, reasons: ['consultant_reassigned', 'verification_drift'] })
    render(<ReadbackGate applicationId="app-1" onChange={() => {}} />)
    expect(await screen.findByText(/reassigned to a different consultant/)).toBeInTheDocument()
    expect(screen.getByText(/no longer match your documents/)).toBeInTheDocument()
  })

  it('no review yet vs a review in progress', async () => {
    getActivePreflight.mockResolvedValue(null)
    const { unmount } = render(<ReadbackGate applicationId="app-1" onChange={() => {}} />)
    expect(await screen.findByText(/has not started the pre-submission review/)).toBeInTheDocument()
    unmount()

    getActivePreflight.mockResolvedValue({ id: 'r1', status: 'in_review', locked_diff_hash: null })
    render(<ReadbackGate applicationId="app-1" onChange={() => {}} />)
    expect(await screen.findByText(/is reviewing the values/)).toBeInTheDocument()
  })

  it('an approval that cannot be read does not block (the server still enforces it)', async () => {
    getConsultantApproval.mockRejectedValue(new Error('boom'))
    render(<ReadbackGate applicationId="app-1" onChange={() => {}} />)
    expect(await screen.findByText('Confirm what will be entered')).toBeInTheDocument()
  })
})

/**
 * "These values are correct" un-ticked itself: `useEffect(() =>
 * setConfirmed(false), [mappings])` fired on every reload because each reload
 * returns a new array. It must reset only when the values themselves change.
 */
describe('ReadbackGate confirmation tick', () => {
  beforeEach(() => {
    getSession.mockReset().mockResolvedValue({ data: { session: { access_token: 't' } } })
    getPreflightMappings.mockReset().mockImplementation(async () => [
      { fieldKey: 'given_name', targetField: '#g', mappedValue: 'Ada' },
      { fieldKey: 'family_name', targetField: '#f', mappedValue: 'Lovelace' },
    ])
    getActivePreflight.mockReset().mockResolvedValue({ id: 'r1', status: 'completed', locked_diff_hash: 'h' })
    validatePreflightLock.mockReset().mockResolvedValue({ valid: true, reasons: [] })
    getConsultantApproval.mockReset().mockResolvedValue(APPROVED)
  })

  it('survives a reload that returns the same values (new array, reordered)', async () => {
    const onChange = vi.fn()
    render(<ReadbackGate applicationId="app-1" onChange={onChange} />)
    const box = await screen.findByRole('checkbox')
    fireEvent.click(box)
    expect(box).toBeChecked()

    const second = [
      { fieldKey: 'family_name', targetField: '#f', mappedValue: 'Lovelace' },
      { fieldKey: 'given_name', targetField: '#g', mappedValue: 'Ada' },
    ]
    getPreflightMappings.mockImplementation(async () => second)
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    // The reload has landed once the gate re-publishes the NEW array.
    await waitFor(() =>
      expect(onChange.mock.calls.some(([st]) => (st as { mappings: unknown }).mappings === second)).toBe(true),
    )

    expect(screen.getByRole('checkbox')).toBeChecked()
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ confirmed: true }))
  })

  it('resets when a value actually changed', async () => {
    render(<ReadbackGate applicationId="app-1" onChange={() => {}} />)
    const box = await screen.findByRole('checkbox')
    fireEvent.click(box)
    expect(box).toBeChecked()

    getPreflightMappings.mockImplementation(async () => [
      { fieldKey: 'given_name', targetField: '#g', mappedValue: 'Ada' },
      { fieldKey: 'family_name', targetField: '#f', mappedValue: 'Byron' },
    ])
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await waitFor(() => expect(screen.getByText('Byron')).toBeInTheDocument())
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })

  it('read-only viewers (not the applicant) get no confirmation box', async () => {
    const onChange = vi.fn()
    render(<ReadbackGate applicationId="app-1" onChange={onChange} readOnly />)
    expect(await screen.findByText(/Only the applicant can confirm/)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })
})

/**
 * The whole IRCC application is now mapped. The gate groups values by IRCC
 * page, shows the legal declarations apart so the applicant confirms each one,
 * and lists what is left for the applicant (and why).
 */
describe('ReadbackGate with the full IRCC mapping', () => {
  beforeEach(() => {
    getSession.mockReset().mockResolvedValue({ data: { session: { access_token: 't' } } })
    getActivePreflight.mockReset().mockResolvedValue({ id: 'r1', status: 'completed', locked_diff_hash: 'h' })
    validatePreflightLock.mockReset().mockResolvedValue({ valid: true, reasons: [] })
    getConsultantApproval.mockReset().mockResolvedValue(APPROVED)
    getPreflightMappings.mockReset().mockResolvedValue([
      { fieldKey: 'birth_city', targetField: '#cityBirth_input', mappedValue: 'Rawalpindi', category: 'passport', page: '/nationality', label: 'City of birth' },
      { fieldKey: 'tuberculosis', targetField: '#hasTuberculosis_radio-button-02-input', mappedValue: 'No', category: 'travel_history', page: '/medical-tuberculosis', label: 'Diagnosed with tuberculosis in the last 2 years', op: 'radio', declaration: true },
    ])
    getPortalFillCoverage.mockReset().mockResolvedValue({
      pages: [
        { page: '/nationality', title: 'Citizenship and places lived', filled: 1, left: [{ label: 'Citizen of more than one country', reason: 'not_in_profile' }] },
        { page: '/medical-tuberculosis', title: 'Tuberculosis', filled: 1, left: [{ label: 'Close contact with a person with tuberculosis in the last 5 years', reason: 'needs_your_answer' }] },
      ],
    })
  })

  it('shows declarations apart, values under their IRCC page, and what is left', async () => {
    render(<ReadbackGate applicationId="app-1" onChange={() => {}} />)
    const decl = await screen.findByRole('region', { name: 'Your declarations' })
    expect(decl).toHaveTextContent('Diagnosed with tuberculosis in the last 2 years')
    expect(decl).toHaveTextContent('No')
    expect(screen.getByRole('region', { name: 'Citizenship and places lived' })).toHaveTextContent('Rawalpindi')
    const left = screen.getByRole('region', { name: 'Left for you on IRCC' })
    expect(left).toHaveTextContent('Close contact with a person with tuberculosis in the last 5 years — needs your answer')
    expect(left).toHaveTextContent('Citizen of more than one country — not in your VisaAI data')
    expect(screen.getByText('These values are correct, including my declarations')).toBeInTheDocument()
    // A declaration is listed once, not again under its page.
    expect(screen.queryByRole('region', { name: 'Tuberculosis' })).not.toBeInTheDocument()
  })

  it('still works when the coverage cannot be loaded', async () => {
    getPortalFillCoverage.mockRejectedValueOnce(new Error('nope'))
    render(<ReadbackGate applicationId="app-1" onChange={() => {}} />)
    expect(await screen.findByText('Confirm what will be entered')).toBeInTheDocument()
    expect(screen.getByText('Rawalpindi')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Left for you on IRCC' })).not.toBeInTheDocument()
  })
})
