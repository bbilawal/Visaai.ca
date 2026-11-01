import type {
  ConsultantState,
  ConversationStatus,
  ConversationThread,
  GlobalMessageSearchResult,
  Message,
  MessageCategory,
  MessagePage,
} from '@visaai/types'
import { apiFetch } from './client'

/**
 * Client-safe messaging API functions. Uses apiFetch ONLY (no server.ts /
 * next/headers) so it is importable from client components. The backend
 * re-checks ownership + role + assignment server-side — JwtGuard is the real
 * boundary.
 *
 * Routes:
 *   GET  /messaging/:applicationId
 *   POST /messaging/:applicationId/messages  { body, category, parentMessageId? }
 *   POST /messaging/:applicationId/read
 *   PATCH /messaging/:applicationId/status   { status }
 *   GET  /messaging/notifications
 *   POST /messaging/notifications/read
 */

export const getThread = (token: string, applicationId: string) =>
  apiFetch<ConversationThread>(`/messaging/${applicationId}`, token)

export const postMessage = (
  token: string,
  applicationId: string,
  input: { body: string; category: MessageCategory; parentMessageId?: string | null },
) =>
  apiFetch<{ id: string }>(`/messaging/${applicationId}/messages`, token, {
    method: 'POST',
    body: JSON.stringify(input),
  })

export const markRead = (token: string, applicationId: string) =>
  apiFetch<void>(`/messaging/${applicationId}/read`, token, {
    method: 'POST',
  })

export const setStatus = (
  token: string,
  applicationId: string,
  status: ConversationStatus,
) =>
  apiFetch<void>(`/messaging/${applicationId}/status`, token, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })

export const setConsultantState = (token: string, applicationId: string, state: ConsultantState) =>
  apiFetch<{ state: ConsultantState }>(`/messaging/${applicationId}/consultant-state`, token, { method: 'PATCH', body: JSON.stringify({ state }) })

export const searchMessages = (token: string, applicationId: string, q: string) =>
  apiFetch<Message[]>(`/messaging/${applicationId}/search?q=${encodeURIComponent(q)}`, token)

export const searchAllMessages = (token: string, q: string) =>
  apiFetch<GlobalMessageSearchResult[]>(
    `/messaging/search?q=${encodeURIComponent(q)}`,
    token,
  )

export const listOlderMessages = (token: string, applicationId: string, before: string, limit = 50) =>
  apiFetch<MessagePage>(
    `/messaging/${applicationId}/messages?before=${encodeURIComponent(before)}&limit=${limit}`,
    token,
  )
