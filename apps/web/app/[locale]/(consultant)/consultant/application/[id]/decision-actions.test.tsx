/**
 * Live 2026-10-19: "Approve application" went through while the pre-submission
 * review had just been restarted (not locked). Approval turns auto-fill on, so
 * the button now waits for a valid lock whenever there is a portal fill.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { ApiError } from '@/lib/api/client'

const getPreflightMappings = vi.fn()
const getActivePreflight = vi.fn()
const validatePreflightLock = vi.fn()
const approveApplication = vi.fn()
const getConsultantApproval = vi.fn()
const toast = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('next-intl', async () => {
  const en = (await import('@/messages/en.json')).default as { consultant: Record<string, string> }
  return { useTranslations: () => (key: string) => en.consultant[key] ?? key }
})
vi.mock('@/lib/supabase/client', () => ({
  getSession: () => Promise.resolve({ data: { session: { access_token: 't' } } }),
}))
vi.mock('@/components/providers/toast-provider', () => ({
  useToast: () => ({ toast: (...a: unknown[]) => toast(...a) }),
}))
vi.mock('@/lib/api/consultant-client', () => ({
  approveApplication: (...a: unknown[]) => approveApplication(...a),
  rejectApplication: vi.fn(),
  getConsultantApproval: (...a: unknown[]) => getConsultantApproval(...a),
}))
vi.mock('@/lib/api/preflight-client', () => ({
  getPreflightMappings: (...a: unknown[]) => getPreflightMappings(...a),
  getActivePreflight: (...a: unknown[]) => getActivePreflight(...a),
  validatePreflightLock: (...a: unknown[]) => validatePreflightLock(...a),
}))

import { DecisionActions } from './decision-actions'
import { notifyPreflightLockChanged, notifyReviewItemDecided } from '@/lib/preflight-events'

const MAPPINGS = [{ fieldKey: 'given_name', category: 'passport', mappedValue: 'A' }]
const LOCKED = { id: 'r-1', status: 'completed', locked_diff_hash: 'h' }
const approveButton = () => screen.getByRole('button', { name: 'Approve application' })
const HINT = /Lock the pre-submission review first/

describe('DecisionActions — approve needs a valid pre-submission lock', () => {
  beforeEach(() => {
    getPreflightMappings.mockReset().mockResolvedValue(MAPPINGS)
    getActivePreflight.mockReset().mockResolvedValue(LOCKED)
    validatePreflightLock.mockReset().mockResolvedValue({ valid: true, reasons: [] })
  })

  it('enables Approve when the lock is valid', async () => {
    render(<DecisionActions applicationId="app-1" />)
    await waitFor(() => expect(approveButton()).toBeEnabled())
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
  })

  it('disables Approve with a hint while the review is in progress', async () => {
    getActivePreflight.mockResolvedValue({ id: 'r-2', status: 'in_review', locked_diff_hash: null })
    render(<DecisionActions applicationId="app-1" />)
    expect(await screen.findByText(HINT)).toBeInTheDocument()
    expect(approveButton()).toBeDisabled()
    // Reject stays available.
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled()
  })

  it('disables Approve when the lock is no longer valid', async () => {
    validatePreflightLock.mockResolvedValue({ valid: false, reasons: ['provenance_or_mapping_changed'] })
    render(<DecisionActions applicationId="app-1" />)
    expect(await screen.findByText(HINT)).toBeInTheDocument()
    expect(approveButton()).toBeDisabled()
  })

  it('keeps Approve enabled for a route with no portal fill', async () => {
    getPreflightMappings.mockResolvedValue([])
    getActivePreflight.mockResolvedValue(null)
    render(<DecisionActions applicationId="app-1" />)
    await waitFor(() => expect(approveButton()).toBeEnabled())
  })

  it('re-checks when the review panel locks', async () => {
    getActivePreflight.mockResolvedValue({ id: 'r-2', status: 'in_review', locked_diff_hash: null })
    render(<DecisionActions applicationId="app-1" />)
    expect(await screen.findByText(HINT)).toBeInTheDocument()
    getActivePreflight.mockResolvedValue(LOCKED)
    act(() => notifyPreflightLockChanged('app-1'))
    await waitFor(() => expect(approveButton()).toBeEnabled())
  })
})

/**
 * Live 2026-10-19: "Yes, approve" got a 403 (not the active assignee — the
 * browser had switched accounts) and the page looked unchanged. Every refusal
 * must be visible and must never read as success.
 */
describe('DecisionActions — an approved application is shown as approved', () => {
  beforeEach(() => {
    getPreflightMappings.mockReset().mockResolvedValue([])
    getActivePreflight.mockReset().mockResolvedValue(null)
    validatePreflightLock.mockReset()
    getConsultantApproval.mockReset()
  })

  // Live 2026-10-20: after a reload "Approve application" was offered again on
  // an approved application, and it was approved twice.
  it('disables Approve and says so when the rollup is approved', async () => {
    getConsultantApproval.mockResolvedValue({ applicationApproved: true })
    render(<DecisionActions applicationId="app-1" />)
    expect(await screen.findByRole('status')).toHaveTextContent('Application approved')
    expect(approveButton()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled()
  })

  it('offers Approve again when a later decision un-approves it', async () => {
    getConsultantApproval.mockResolvedValue({ applicationApproved: true })
    render(<DecisionActions applicationId="app-1" />)
    await screen.findByRole('status')
    getConsultantApproval.mockResolvedValue({ applicationApproved: false })
    act(() => notifyReviewItemDecided('app-1'))
    await waitFor(() => expect(approveButton()).toBeEnabled())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  // Review finding: a re-lock retires the approval (it predates the new lock),
  // but only the lock-changed event fires — the button stayed "approved".
  it('offers Approve again after a re-lock retires the approval', async () => {
    getConsultantApproval.mockResolvedValue({ applicationApproved: true })
    render(<DecisionActions applicationId="app-1" />)
    await screen.findByRole('status')
    getConsultantApproval.mockResolvedValue({ applicationApproved: false })
    act(() => notifyPreflightLockChanged('app-1'))
    await waitFor(() => expect(approveButton()).toBeEnabled())
  })

  it('only the newest re-check lands', async () => {
    getConsultantApproval.mockResolvedValue({ applicationApproved: false })
    render(<DecisionActions applicationId="app-1" />)
    await waitFor(() => expect(approveButton()).toBeEnabled())
    let slow: (v: { applicationApproved: boolean }) => void = () => {}
    getConsultantApproval.mockReturnValueOnce(new Promise(r => { slow = r }))
    act(() => notifyReviewItemDecided('app-1'))
    getConsultantApproval.mockResolvedValueOnce({ applicationApproved: false })
    act(() => notifyReviewItemDecided('app-1'))
    await act(async () => { slow({ applicationApproved: true }) })
    expect(approveButton()).toBeEnabled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('an unreadable rollup leaves Approve usable', async () => {
    getConsultantApproval.mockRejectedValue(new Error('down'))
    render(<DecisionActions applicationId="app-1" />)
    await waitFor(() => expect(approveButton()).toBeEnabled())
  })
})

describe('DecisionActions — viewer who is not the assigned consultant', () => {
  beforeEach(() => {
    getPreflightMappings.mockReset().mockResolvedValue([])
    getActivePreflight.mockReset().mockResolvedValue(null)
    getConsultantApproval.mockReset().mockResolvedValue({ applicationApproved: false })
    approveApplication.mockReset()
  })

  // Owner, 2026-10-20: an admin saw an active Approve button that always
  // answered 403 "not the assigned consultant". Show it disabled, with why.
  it('disables Approve and Reject and says only the assigned consultant can decide', async () => {
    render(<DecisionActions applicationId="app-1" canDecide={false} />)
    expect(await screen.findByRole('note')).toHaveTextContent(/Only the assigned consultant/)
    await waitFor(() => expect(approveButton()).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled()
    fireEvent.click(approveButton())
    expect(approveApplication).not.toHaveBeenCalled()
  })

  it('the assigned consultant keeps the buttons', async () => {
    render(<DecisionActions applicationId="app-1" canDecide />)
    await waitFor(() => expect(approveButton()).toBeEnabled())
    expect(screen.queryByText(/Only the assigned consultant/)).not.toBeInTheDocument()
  })
})

describe('DecisionActions — a refused approval is shown, never a success', () => {
  beforeEach(() => {
    getPreflightMappings.mockReset().mockResolvedValue(MAPPINGS)
    getActivePreflight.mockReset().mockResolvedValue(LOCKED)
    validatePreflightLock.mockReset().mockResolvedValue({ valid: true, reasons: [] })
    approveApplication.mockReset()
    toast.mockReset()
  })

  async function approve() {
    render(<DecisionActions applicationId="app-1" />)
    await waitFor(() => expect(approveButton()).toBeEnabled())
    fireEvent.click(approveButton())
    fireEvent.click(screen.getByRole('button', { name: 'Yes, approve' }))
  }

  it('403 not-assignee: says to sign in as the assigned consultant', async () => {
    approveApplication.mockRejectedValue(new ApiError(
      403, 'POST /applications/app-1/consultant/approve -> 403',
      'consultant 0f2c is not the active assignee',
    ))
    await approve()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "You're not the assigned consultant for this application. Sign in with the assigned consultant account.",
    )
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('not the assigned consultant'), 'error')
    expect(toast).not.toHaveBeenCalledWith(expect.anything(), 'success')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await waitFor(() => expect(approveButton()).toBeEnabled())
  })

  it("409 lock gate: shows the server's reason", async () => {
    approveApplication.mockRejectedValue(new ApiError(409, 'POST /x -> 409', 'Lock the pre-submission review first.'))
    await approve()
    expect(await screen.findByRole('alert')).toHaveTextContent('Lock the pre-submission review first.')
    expect(toast).not.toHaveBeenCalledWith(expect.anything(), 'success')
  })

  // Live 2026-10-20: a document marked "Needs re-upload" did not block approval.
  it('409 open document request: names the document and what to do', async () => {
    const reason =
      'Cannot approve yet: a document has an open review request: passport.pdf (re-upload requested). Wait for the applicant to upload a replacement, or approve the document.'
    approveApplication.mockRejectedValue(new ApiError(409, 'POST /x -> 409', reason))
    await approve()
    expect(await screen.findByRole('alert')).toHaveTextContent(reason)
    expect(toast).toHaveBeenCalledWith(reason, 'error')
    expect(toast).not.toHaveBeenCalledWith(expect.anything(), 'success')
  })

  // Live 2026-10-20: the refusal stayed on screen after the consultant went on
  // to decide documents, so it still read as the current state.
  it('clears a refusal once a document decision changes', async () => {
    approveApplication.mockRejectedValue(new ApiError(409, 'POST /x -> 409', 'Cannot approve yet: a document has an open review request: a.jpg (re-upload requested).'))
    await approve()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    act(() => notifyReviewItemDecided('app-other'))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    act(() => notifyReviewItemDecided('app-1'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('503: shows the server reason', async () => {
    approveApplication.mockRejectedValue(new ApiError(503, 'POST /x -> 503', 'Application approval is unavailable.'))
    await approve()
    expect(await screen.findByRole('alert')).toHaveTextContent('Application approval is unavailable.')
  })
})
