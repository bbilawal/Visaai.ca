import type { ConsultantNote } from '@visaai/types'
import { apiFetch } from './client'

export const listNotes = (token: string, applicationId: string) =>
  apiFetch<ConsultantNote[]>(`/messaging/${applicationId}/notes`, token)

export const createNote = (token: string, applicationId: string, body: string) =>
  apiFetch<ConsultantNote>(`/messaging/${applicationId}/notes`, token, { method: 'POST', body: JSON.stringify({ body }) })

export const updateNote = (token: string, noteId: string, body: string) =>
  apiFetch<ConsultantNote>(`/messaging/notes/${noteId}`, token, { method: 'PATCH', body: JSON.stringify({ body }) })
