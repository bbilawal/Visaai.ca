import type { DocumentRequest, DocumentRequestPriority, DocumentRequestStatus } from '@visaai/types'
import { apiFetch } from './client'

export const listDocumentRequests = (token: string, applicationId: string) =>
  apiFetch<DocumentRequest[]>(`/messaging/${applicationId}/document-requests`, token)

export const createDocumentRequest = (
  token: string,
  applicationId: string,
  body: { documentType: string; label: string; notes?: string; dueDate?: string; priority?: DocumentRequestPriority; checklistItemId?: string },
) => apiFetch<DocumentRequest>(`/messaging/${applicationId}/document-requests`, token, { method: 'POST', body: JSON.stringify(body) })

export const fulfillDocumentRequest = (token: string, requestId: string, attachmentId: string) =>
  apiFetch<DocumentRequest>(`/messaging/document-requests/${requestId}/fulfill`, token, { method: 'POST', body: JSON.stringify({ attachmentId }) })

export const setDocumentRequestStatus = (token: string, requestId: string, status: DocumentRequestStatus) =>
  apiFetch<DocumentRequest>(`/messaging/document-requests/${requestId}/status`, token, { method: 'PATCH', body: JSON.stringify({ status }) })
