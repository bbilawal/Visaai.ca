import { apiFetch } from './client'

export const draftReply = (token: string, applicationId: string, instruction?: string) =>
  apiFetch<{ draft: string }>(`/messaging/${applicationId}/ai-draft`, token, {
    method: 'POST',
    body: JSON.stringify(instruction ? { instruction } : {}),
  })
