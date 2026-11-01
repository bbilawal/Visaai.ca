import { serverApi } from './server'
import type {
  AdminApplicationView,
  ApplicantApplicationView,
  ConsultantDashboard,
  ConsultantQueueResult,
} from '@visaai/types'

/**
 * Server-side reads for the country-scoped assignment views. Thin wrappers over
 * the NestJS endpoints — ALL filtering/RBAC/derivation happens server-side; the
 * UI only renders these responses.
 */

/** Consultant portal: Phase-1 dashboard aggregate (counts + SLA buckets). */
export const getConsultantDashboard = () =>
  serverApi<ConsultantDashboard>('/consultant/dashboard')

/** Consultant portal: { queue (eligible unassigned), mine (assigned to me) }. */
export const getConsultantQueue = () =>
  serverApi<ConsultantQueueResult>('/consultant/applications')

/** Filter args for the admin applications list (all optional, empties omitted). */
export interface AdminApplicationsQuery {
  status?: string
  country?: string
  /** Free-text application-id substring. */
  q?: string
  /** Active-assignee email substring. */
  assignee?: string
  /** Derived assignment status filter. */
  assignmentStatus?: 'ASSIGNED' | 'UNASSIGNED'
  /** Deadline range (ISO). */
  deadlineFrom?: string
  deadlineTo?: string
}

/** Admin portal: every application + derived status + assignee + date. */
export const getAdminApplications = (q?: AdminApplicationsQuery) => {
  const qs = new URLSearchParams()
  // Omit empty/whitespace values so they never reach the backend as no-op filters.
  const set = (key: string, value: string | undefined) => {
    const v = value?.trim()
    if (v) qs.set(key, v)
  }
  set('status', q?.status)
  set('country', q?.country)
  set('q', q?.q)
  set('assignee', q?.assignee)
  set('assignmentStatus', q?.assignmentStatus)
  set('deadlineFrom', q?.deadlineFrom)
  set('deadlineTo', q?.deadlineTo)
  const s = qs.toString()
  return serverApi<AdminApplicationView[]>(`/admin/applications${s ? `?${s}` : ''}`)
}

/** Applicant portal: own applications + assigned consultant + status. */
export const getApplicantApplications = () =>
  serverApi<ApplicantApplicationView[]>('/applicant/applications')
