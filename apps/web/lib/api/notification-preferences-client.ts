import type { NotificationPreferences } from '@visaai/types'
import { apiFetch } from './client'

export const getNotificationPreferences = (token: string) =>
  apiFetch<NotificationPreferences>('/notifications/preferences', token)

export const updateNotificationPreferences = (
  token: string,
  patch: {
    email_enabled?: boolean
    push_enabled?: boolean
    sms_enabled?: boolean
    categories?: Record<string, boolean>
    quiet_hours_start?: number | null
    quiet_hours_end?: number | null
    timezone?: string | null
    language?: string | null
  },
) =>
  apiFetch<NotificationPreferences>('/notifications/preferences', token, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
