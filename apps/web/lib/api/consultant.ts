import { serverApi } from './server'
import type { ConsultantReviewData } from '@visaai/types'

export interface AssignedApplication {
  id: string
  visa_type: string | null
  status: string | null
  created_at: string | null
}

/** Server-side: applications actively assigned to the current consultant. */
export const getAssignedApplications = () => serverApi<AssignedApplication[]>('/consultant/assigned')

/** Server-side: per-application approval rollup (existing endpoint). */
export const getApplicationApproval = (applicationId: string) =>
  serverApi<unknown>(`/applications/${applicationId}/consultant/approval`)

/** Server-side: full review payload (summary + field values + documents). */
export const getConsultantReview = (applicationId: string) =>
  serverApi<ConsultantReviewData>(`/applications/${applicationId}/consultant/review`)
