import { describe, expect, it } from 'vitest'
import type { ConsultantApprovalRollup } from '@visaai/types'
import {
  APPROVAL_CHECK_UNAVAILABLE_TEXT,
  CONSULTANT_NOT_APPROVED_TEXT,
  DOCUMENT_REVIEW_OPEN_TEXT,
  approvalBlockText,
  executionReasonText,
} from './readback-reasons'

const rollup = (over: Partial<ConsultantApprovalRollup> = {}): ConsultantApprovalRollup => ({
  applicationId: 'app-1',
  fields: [],
  sections: [],
  applicationApproved: false,
  ...over,
})

describe('approvalBlockText — consultant document requests', () => {
  it('an open document request says to replace the document, not "not approved yet"', () => {
    expect(approvalBlockText(rollup({ approvalBlockers: ['Cannot approve yet: passport.pdf'] }))).toBe(
      DOCUMENT_REVIEW_OPEN_TEXT,
    )
  })

  it('an unreadable review state is not reported as a missing approval', () => {
    expect(approvalBlockText(rollup({ approvalCheckUnavailable: true }))).toBe(APPROVAL_CHECK_UNAVAILABLE_TEXT)
  })

  it('no approval at all still reads "not approved yet"', () => {
    expect(approvalBlockText(rollup())).toBe(CONSULTANT_NOT_APPROVED_TEXT)
  })

  it('approved: nothing to say', () => {
    expect(approvalBlockText(rollup({ applicationApproved: true }))).toBeNull()
  })

  it('maps the new eligibility reasons to plain words', () => {
    expect(executionReasonText('document_review_open')).toBe(DOCUMENT_REVIEW_OPEN_TEXT)
    expect(executionReasonText('approval_check_unavailable')).toBe(APPROVAL_CHECK_UNAVAILABLE_TEXT)
  })
})
