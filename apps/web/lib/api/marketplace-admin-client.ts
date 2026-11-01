import { apiFetch } from './client'
import type { ConsultantProfile } from '@visaai/types'

export type ReviewStatus = 'draft' | 'pending_review' | 'active' | 'suspended'

export interface ReviewableConsultant extends ConsultantProfile {
  full_name: string | null
}

/**
 * Admin review of consultant marketplace profiles. Client-safe.
 *
 * `active` and `suspended` are admin-only transitions — a consultant can only
 * self-serve as far as `pending_review` — so this is the only path that makes a
 * submitted profile bookable.
 */
export const listConsultantsForReview = (token: string, status: ReviewStatus) =>
  apiFetch<ReviewableConsultant[]>(
    `/admin/marketplace/consultants?status=${status}`,
    token,
  )

export const setConsultantStatus = (
  token: string,
  id: string,
  active_status: 'active' | 'suspended' | 'draft',
) =>
  apiFetch<ConsultantProfile>(`/admin/marketplace/consultants/${id}/status`, token, {
    method: 'POST',
    body: JSON.stringify({ active_status }),
  })
