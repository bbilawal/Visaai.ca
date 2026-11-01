import type { AttachmentKind, MessageAttachment, SignedUploadResult, VoiceMessage } from '@visaai/types'
import { apiFetch } from './client'

export const requestUploadUrl = (
  token: string,
  applicationId: string,
  meta: { fileName: string; mimeType: string; sizeBytes: number; kind: AttachmentKind | 'voice' },
) =>
  apiFetch<SignedUploadResult>(`/messaging/${applicationId}/attachments/upload-url`, token, {
    method: 'POST',
    body: JSON.stringify(meta),
  })

/** PUT the file bytes to the Supabase signed upload URL (no auth header). */
export async function putToSignedUrl(uploadUrl: string, file: Blob, mimeType: string): Promise<void> {
  const res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: file })
  if (!res.ok) throw new Error(`upload failed: ${res.status}`)
}

export const confirmAttachment = (
  token: string,
  applicationId: string,
  body: { storagePath: string; fileName: string; mimeType: string; sizeBytes: number; kind: AttachmentKind; body?: string },
) => apiFetch<MessageAttachment>(`/messaging/${applicationId}/attachments`, token, { method: 'POST', body: JSON.stringify(body) })

export const confirmVoice = (
  token: string,
  applicationId: string,
  body: { storagePath: string; mimeType: string; durationMs: number; sizeBytes: number },
) => apiFetch<VoiceMessage>(`/messaging/${applicationId}/voice`, token, { method: 'POST', body: JSON.stringify(body) })

export const getAttachmentUrl = (token: string, attachmentId: string) =>
  apiFetch<{ url: string }>(`/messaging/attachments/${attachmentId}/url`, token)

export const getVoiceUrl = (token: string, voiceId: string) =>
  apiFetch<{ url: string }>(`/messaging/voice/${voiceId}/url`, token)
