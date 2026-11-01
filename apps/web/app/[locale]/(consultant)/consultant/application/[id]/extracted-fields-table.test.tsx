/**
 * The "Fields" table lists every extracted (OCR/intake) value with the
 * consultant's decision. On prod app 71ad0c29 it was read-only and full of OCR
 * garbage (currency "V", date_of_birth "2025-06-30" from a refusal letter) with
 * every decision stuck at "pending" — the approve/reject API existed but no UI
 * reached it. The consultant can now correct, approve or reject each value.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const editPreflightField = vi.fn()
const approveField = vi.fn()
const rejectField = vi.fn()
const markFieldNotApplicable = vi.fn()
const refresh = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/lib/supabase/client', () => ({
  getSession: () => Promise.resolve({ data: { session: { access_token: 't' } } }),
}))
vi.mock('@/components/providers/toast-provider', () => ({
  useToast: () => ({ toast: () => {} }),
}))
vi.mock('@/lib/api/preflight-client', () => ({
  editPreflightField: (...a: unknown[]) => editPreflightField(...a),
}))
vi.mock('@/lib/api/consultant-client', () => ({
  approveField: (...a: unknown[]) => approveField(...a),
  rejectField: (...a: unknown[]) => rejectField(...a),
  markFieldNotApplicable: (...a: unknown[]) => markFieldNotApplicable(...a),
}))

import ExtractedFieldsTable from './extracted-fields-table'

const FIELDS = [
  { fieldKey: 'currency', value: 'V', valueHash: 'h-v', origin: 'ocr', confidence: 0.4, decision: 'pending' as const, approved: false, stale: false },
  { fieldKey: 'job_title', value: 'HR Data Quality Coordinator', valueHash: 'h-j', origin: 'ocr', confidence: null, decision: 'approved' as const, approved: false, stale: true },
]

describe('ExtractedFieldsTable', () => {
  beforeEach(() => {
    for (const f of [editPreflightField, approveField, rejectField, markFieldNotApplicable, refresh]) f.mockReset()
    markFieldNotApplicable.mockResolvedValue({})
    editPreflightField.mockResolvedValue({})
    approveField.mockResolvedValue({})
    rejectField.mockResolvedValue({})
  })

  it('corrects a value through the shared field-edit endpoint, then refreshes', async () => {
    render(<ExtractedFieldsTable applicationId="app-1" fields={FIELDS} />)
    fireEvent.click(screen.getByRole('button', { name: 'Correct currency' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Corrected value for currency' }), { target: { value: 'PKR' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Reason for currency' }), { target: { value: 'OCR misread' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(editPreflightField).toHaveBeenCalledWith('t', 'app-1', 'currency', 'PKR', 'OCR misread'))
    expect(refresh).toHaveBeenCalled()
  })

  it('approves the CURRENT value (bound to its hash)', async () => {
    render(<ExtractedFieldsTable applicationId="app-1" fields={FIELDS} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve currency' }))
    await waitFor(() => expect(approveField).toHaveBeenCalledWith('t', 'app-1', 'currency', 'h-v'))
  })

  it('offers re-approval for a stale approval', () => {
    render(<ExtractedFieldsTable applicationId="app-1" fields={FIELDS} />)
    expect(screen.getByText(/approved \(stale\)/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve job_title' })).toBeEnabled()
  })

  it('rejecting requires a reason and warns that it blocks auto-fill', async () => {
    render(<ExtractedFieldsTable applicationId="app-1" fields={FIELDS} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reject currency' }))
    expect(screen.getByText(/Rejecting blocks portal auto-fill until/)).toBeInTheDocument()
    const confirm = screen.getByRole('button', { name: 'Confirm reject' })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Reject reason for currency' }), { target: { value: 'from the son’s letter' } })
    fireEvent.click(confirm)
    await waitFor(() => expect(rejectField).toHaveBeenCalledWith('t', 'app-1', 'currency', 'from the son’s letter'))
  })

  it('a correction tells the pre-submission review to re-read its checks (#31)', async () => {
    const heard = vi.fn()
    window.addEventListener('visaai:preflight-changed', heard)
    render(<ExtractedFieldsTable applicationId="app-1" fields={FIELDS} />)
    fireEvent.click(screen.getByRole('button', { name: 'Correct currency' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Corrected value for currency' }), { target: { value: 'PKR' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(heard).toHaveBeenCalled())
    expect((heard.mock.calls[0][0] as CustomEvent).detail).toEqual({ applicationId: 'app-1' })
    window.removeEventListener('visaai:preflight-changed', heard)
  })

  /**
   * #32: OCR junk (sponsor job title, currency "V") had only Reject, which
   * blocks auto-fill for the whole application. 'Not applicable' drops the
   * value from auto-fill without blocking it.
   */
  it('marks a field not applicable without blocking auto-fill', async () => {
    const heard = vi.fn()
    window.addEventListener('visaai:preflight-changed', heard)
    render(<ExtractedFieldsTable applicationId="app-1" fields={FIELDS} />)
    fireEvent.click(screen.getByRole('button', { name: 'Not applicable job_title' }))
    expect(screen.getByText(/left out of portal auto-fill.*does not block/i)).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Not applicable reason for job_title' }), { target: { value: 'sponsor letter, not the applicant' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm not applicable' }))
    await waitFor(() =>
      expect(markFieldNotApplicable).toHaveBeenCalledWith('t', 'app-1', 'job_title', 'sponsor letter, not the applicant'),
    )
    expect(rejectField).not.toHaveBeenCalled()
    await waitFor(() => expect(heard).toHaveBeenCalled())
    window.removeEventListener('visaai:preflight-changed', heard)
  })

  it('shows a not_applicable decision in words', () => {
    render(
      <ExtractedFieldsTable
        applicationId="app-1"
        fields={[{ ...FIELDS[0], decision: 'not_applicable' as const }]}
      />,
    )
    expect(screen.getByText('not applicable')).toBeInTheDocument()
  })
})
