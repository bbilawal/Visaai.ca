import type { ConsultantApprovalRollup } from '@visaai/types'
import { apiFetch } from './client'

/**
 * Client-safe consultant decision actions. Uses apiFetch ONLY (no server.ts /
 * next/headers) so it is importable from client components. The backend
 * re-checks role + assignment server-side — JwtGuard + RolesGuard('consultant')
 * + ConsultantApprovalService.assertAssigned — so showing/hiding these buttons
 * is never the security boundary.
 *
 * Routes (application-scope decisions):
 *   POST /applications/:id/consultant/approve
 *   POST /applications/:id/consultant/reject   { reason }
 */
export const approveApplication = (token: string, applicationId: string) =>
  apiFetch<unknown>(`/applications/${applicationId}/consultant/approve`, token, {
    method: 'POST',
  })

export const rejectApplication = (token: string, applicationId: string, reason: string) =>
  apiFetch<unknown>(`/applications/${applicationId}/consultant/reject`, token, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })

/**
 * Field-scope decisions. Approval binds to the field's CURRENT value hash, so a
 * later change to the value makes the approval stale (and blocks the lock until
 * re-approved). A REJECTED field blocks portal auto-fill until it is approved
 * again — reject means "this value must not be used".
 *   POST /applications/:id/consultant/fields/:key/approve { valueHash }
 *   POST /applications/:id/consultant/fields/:key/reject  { reason }
 */
export const approveField = (
  token: string,
  applicationId: string,
  fieldKey: string,
  valueHash: string,
) =>
  apiFetch<unknown>(
    `/applications/${applicationId}/consultant/fields/${encodeURIComponent(fieldKey)}/approve`,
    token,
    { method: 'POST', body: JSON.stringify({ valueHash }) },
  )

export const rejectField = (
  token: string,
  applicationId: string,
  fieldKey: string,
  reason: string,
) =>
  apiFetch<unknown>(
    `/applications/${applicationId}/consultant/fields/${encodeURIComponent(fieldKey)}/reject`,
    token,
    { method: 'POST', body: JSON.stringify({ reason }) },
  )

/**
 * 'Not applicable': the field does not apply to this application (OCR junk).
 * The value is left out of portal auto-fill, and — unlike reject — auto-fill is
 * NOT blocked. Reason optional.
 *   POST /applications/:id/consultant/fields/:key/not-applicable { reason? }
 */
export const markFieldNotApplicable = (
  token: string,
  applicationId: string,
  fieldKey: string,
  reason?: string,
) =>
  apiFetch<unknown>(
    `/applications/${applicationId}/consultant/fields/${encodeURIComponent(fieldKey)}/not-applicable`,
    token,
    { method: 'POST', body: JSON.stringify(reason ? { reason } : {}) },
  )

/**
 * The consultant approval rollup (read-only; the applicant may read their own).
 * `applicationApproved` is false until the consultant presses "Approve
 * application" — and portal fill refuses to run until it is true.
 *   GET /applications/:id/consultant/approval
 */
export const getConsultantApproval = (token: string, applicationId: string) =>
  apiFetch<ConsultantApprovalRollup>(
    `/applications/${applicationId}/consultant/approval`,
    token,
  )
