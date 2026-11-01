import { serverApi } from './server'
import type { NotificationTemplate } from '@visaai/types'

export interface AdminTemplatesQuery {
  event_type?: string
  locale?: string
}

/** Server-side only — reads templates with admin token via serverApi. */
export const getTemplates = (params: AdminTemplatesQuery = {}) => {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') qs.set(k, String(v))
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return serverApi<NotificationTemplate[]>(`/admin/notification-templates${suffix}`)
}

export const getTemplate = (id: string) =>
  serverApi<NotificationTemplate>(
    `/admin/notification-templates/${encodeURIComponent(id)}`,
  )
