import type {
  ConsultantApprovalRollup,
  PreflightInvalidationReason,
} from '@visaai/types'

/**
 * Applicant-facing explanations for why portal auto-fill cannot run yet.
 *
 * Two server answers feed the Submit page, and both used to surface as either
 * generic text ("Awaiting consultant review") or raw codes ("Portal fill was
 * blocked: consultant_missing"):
 *  - the preflight lock validation (POST preflight/reviews/:id/validate), whose
 *    reasons are PreflightInvalidationReason; and
 *  - the execution request's blockedReasons (EligibilityReason, plus
 *    readback_not_confirmed from the request gate).
 *
 * Each code maps to what actually happened and who has to act.
 */

export const LOCK_REASON_TEXT: Record<PreflightInvalidationReason, string> = {
  not_completed:
    'Your consultant reopened the pre-submission review and has not locked it again yet.',
  already_invalidated:
    'Your consultant started a new pre-submission review, which replaced the locked one. It needs to be completed and locked again.',
  no_active_consultant:
    'No consultant is assigned to your application right now, so the locked review cannot be used. A consultant needs to be assigned and lock the review again.',
  consultant_reassigned:
    'Your application was reassigned to a different consultant. Your new consultant needs to review and lock it before auto-fill can run.',
  stale_approval:
    'A value your consultant approved has changed since, so that approval is out of date. Your consultant needs to approve it again.',
  verification_drift:
    'Some verified details no longer match your documents. Your consultant needs to check them and lock the review again.',
  provenance_or_mapping_changed:
    'Some details that auto-fill would enter have changed since your consultant locked the review, so it needs your consultant to review it again before auto-fill can run.',
}

export function lockReasonText(reason: string): string {
  return (
    (LOCK_REASON_TEXT as Record<string, string>)[reason] ??
    `The locked review is no longer valid (${reason}). Your consultant needs to review it again.`
  )
}

/** `consultant_missing` from the eligibility gate, in plain words. */
export const CONSULTANT_NOT_APPROVED_TEXT =
  'Your consultant has locked the pre-submission review but has not approved the application yet. They need to press “Approve application” on their review screen — locking the review alone does not unlock auto-fill.'

export const EXECUTION_REASON_TEXT: Record<string, string> = {
  consultant_missing: CONSULTANT_NOT_APPROVED_TEXT,
  consultant_stale:
    'A value your consultant approved has changed since, so their approval is out of date. Your consultant needs to approve it again.',
  preflight_incomplete:
    'The pre-submission review is not locked. Your consultant needs to complete and lock it.',
  preflight_invalid:
    'Details changed after your consultant locked the pre-submission review. Your consultant needs to review it again.',
  verification_drift:
    'Some verified details no longer match your documents. Your consultant needs to check them again.',
  payment_missing: 'The form-filling fee for this application has not been paid yet.',
  token_invalid: 'This launch session expired. Reload the page and launch again.',
  readback_not_confirmed: 'Confirm the values above before launching.',
}

export function executionReasonText(reason: string): string {
  return EXECUTION_REASON_TEXT[reason] ?? reason
}

/**
 * Why the consultant's approval (not the lock) still blocks the fill, or null
 * when it does not. Mirrors ExecutionEligibilityService: a rejected or revoked
 * field, a stale approval, or no application-scope approval all block.
 */
export function approvalBlockText(rollup: ConsultantApprovalRollup | null): string | null {
  if (!rollup || rollup.applicationApproved) return null
  const rejected = rollup.fields.filter((f) => f.decision === 'rejected' || f.decision === 'revoked')
  if (rejected.length > 0) {
    const keys = rejected.map((f) => f.fieldKey).join(', ')
    return `Your consultant rejected ${rejected.length === 1 ? 'a field' : `${rejected.length} fields`} (${keys}). Auto-fill stays off until they approve ${rejected.length === 1 ? 'it' : 'them'} or mark ${rejected.length === 1 ? 'it' : 'them'} not applicable.`
  }
  if (rollup.fields.some((f) => f.stale)) return EXECUTION_REASON_TEXT.consultant_stale
  return CONSULTANT_NOT_APPROVED_TEXT
}

/**
 * A content key for the values the applicant confirms. The readback tick must
 * reset when these change — and ONLY then: every reload returns a new array,
 * so keying on the array identity un-ticked the box on each reload.
 */
export function readbackKey(
  reviewId: string | null | undefined,
  mappings: ReadonlyArray<{ fieldKey: string; targetField: string; mappedValue: unknown }> | null,
): string | null {
  if (!mappings) return null
  const rows = mappings
    .map((m) => `${m.fieldKey}|${m.targetField}|${m.mappedValue == null ? '' : String(m.mappedValue)}`)
    .sort()
  return `${reviewId ?? ''}\n${rows.join('\n')}`
}
