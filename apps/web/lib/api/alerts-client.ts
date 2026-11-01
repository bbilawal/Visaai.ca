// Client-safe alerts API. MUST NOT import ./server (next/headers):
// this module is imported by 'use client' components.
import { apiFetch } from './client'

export interface AlertRule {
  id: string
  name: string
  metricKey: string
  metric: string
  query: unknown
  conditions: unknown[]
  combine: 'all' | 'any'
  recipients: string[]
  notifyUserIds: string[]
  enabled: boolean
  state: 'ok' | 'breached'
  lastValue: number | null
}
export function alertPath(id?: string): string {
  return id ? `/analytics/alerts/${id}` : '/analytics/alerts'
}
// Server-only reads live in ./alerts.ts — importing serverApi here would pull
// next/headers into every client component that touches this module.
export const createAlert = (token: string, body: Partial<AlertRule>) =>
  apiFetch<AlertRule>('/analytics/alerts', token, { method: 'POST', body: JSON.stringify(body) })
export const updateAlert = (token: string, id: string, patch: Partial<AlertRule>) =>
  apiFetch<AlertRule>(alertPath(id), token, { method: 'PATCH', body: JSON.stringify(patch) })
export const deleteAlert = (token: string, id: string) => apiFetch(alertPath(id), token, { method: 'DELETE' })
export const testAlert = (token: string, id: string) =>
  apiFetch<{ breached: boolean; actual: number | null; wouldFire: boolean }>(`/analytics/alerts/${id}/test`, token, {
    method: 'POST',
  })
