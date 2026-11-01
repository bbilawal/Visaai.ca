import { serverApi } from './server'
import { alertPath, type AlertRule } from './alerts-client'

/**
 * Server-side alert reads (pages only — pulls next/headers via serverApi).
 *
 * Split out of alerts-client.ts for the same reason as analytics.ts: that
 * module is imported by `'use client'` components, and a top-level
 * `import { serverApi }` drags next/headers into the browser bundle and fails
 * `next build`.
 */
export const listAlerts = () => serverApi<AlertRule[]>('/analytics/alerts')

export const getAlert = (id: string) => serverApi<AlertRule>(alertPath(id))

export const listAlertEvents = (id: string) =>
  serverApi<Record<string, unknown>[]>(`/analytics/alerts/${id}/events`)
