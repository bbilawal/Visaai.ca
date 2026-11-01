import { serverApi } from './server'
import type { AssignmentTimelineEvent } from '@visaai/types'

/**
 * Read-only assignment lifecycle timeline for an application. Server-side; the
 * backend authorizes (admin | owner | active assignee) and returns the
 * normalized, chronologically-ordered audit events. UI renders verbatim.
 */
export const getAssignmentTimeline = (applicationId: string) =>
  serverApi<AssignmentTimelineEvent[]>(`/applications/${applicationId}/assignment-timeline`)
