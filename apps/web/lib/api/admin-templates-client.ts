import { apiFetch } from './client'
import type { NotificationTemplate, NotificationTemplateInput } from '@visaai/types'

/**
 * Client-safe admin template helpers. Uses apiFetch only (no server.ts / next/headers),
 * so importable from client components. The backend re-checks admin role server-side
 * (RolesGuard) — this is not a security boundary.
 */

export const createTemplate = (token: string, input: NotificationTemplateInput) =>
  apiFetch<NotificationTemplate>('/admin/notification-templates', token, {
    method: 'POST',
    body: JSON.stringify(input),
  })

export const updateTemplate = (token: string, id: string, input: NotificationTemplateInput) =>
  apiFetch<NotificationTemplate>(
    `/admin/notification-templates/${encodeURIComponent(id)}`,
    token,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  )

export const deactivateTemplate = (token: string, id: string) =>
  apiFetch<{ id: string }>(
    `/admin/notification-templates/${encodeURIComponent(id)}/deactivate`,
    token,
    { method: 'POST' },
  )

export const previewTemplate = (
  token: string,
  payload: { title: string; body: string; sampleVars: Record<string, string> },
) =>
  apiFetch<{ title: string; body: string }>(
    '/admin/notification-templates/preview',
    token,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  )
