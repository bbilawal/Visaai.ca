import type { EscalationRecord, EscalationType } from '@visaai/types'
import { apiFetch } from './client'

export const listEscalations = (token: string, applicationId: string) =>
  apiFetch<EscalationRecord[]>(`/messaging/${applicationId}/escalations`, token)

export const createEscalation = (token: string, applicationId: string, type: EscalationType, reason: string) =>
  apiFetch<EscalationRecord>(`/messaging/${applicationId}/escalations`, token, { method: 'POST', body: JSON.stringify({ type, reason }) })

export const resolveEscalation = (token: string, escalationId: string) =>
  apiFetch<EscalationRecord>(`/messaging/escalations/${escalationId}/resolve`, token, { method: 'PATCH' })
