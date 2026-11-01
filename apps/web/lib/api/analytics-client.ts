// Client-safe analytics API. MUST NOT import ./server (next/headers):
// this module is imported by 'use client' components.
import { apiFetch } from './client'
import type { MetricResult, MetricQuery } from '@visaai/types'

type Q = MetricQuery & { metric?: string }

export function qs(q: Q): string {
  const p = new URLSearchParams()
  p.set('from', q.from)
  p.set('to', q.to)
  p.set('grain', q.grain)
  if (q.metric) p.set('metric', q.metric)
  if (q.compareTo) p.set('compareTo', q.compareTo)
  for (const [k, v] of Object.entries(q.filters ?? {})) if (v != null) p.set(`filters[${k}]`, String(v))
  return p.toString()
}

export function metricPath(key: string, q: Q): string {
  return `/analytics/metrics/${encodeURIComponent(key)}?${qs(q)}`
}
export function exportUrl(key: string, q: Q, format: 'csv' | 'xlsx' | 'pdf'): string {
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
  return `${base}/analytics/metrics/${encodeURIComponent(key)}/export?${qs(q)}&format=${format}`
}

// --- server reads (RSC) ---
// Server-only reads live in ./analytics.ts — importing serverApi here would
// pull next/headers into every client component that touches this module.

// --- client mutations (browser token) ---
export interface SavedReport {
  id: string
  name: string
  metricKey: string
  metric: string
  query: unknown
}
export const listReports = (token: string) => apiFetch<SavedReport[]>('/analytics/reports', token)
export const createReport = (token: string, body: Omit<SavedReport, 'id'>) =>
  apiFetch<SavedReport>('/analytics/reports', token, { method: 'POST', body: JSON.stringify(body) })
export const runReport = (token: string, id: string) =>
  apiFetch<{ result: MetricResult; runId: string }>(`/analytics/reports/${id}/run`, token, { method: 'POST' })
export const scheduleReport = (
  token: string,
  id: string,
  body: { cron: string; format: 'pdf' | 'xlsx'; recipients: string[]; notifyUserIds?: string[] },
) => apiFetch(`/analytics/reports/${id}/schedule`, token, { method: 'POST', body: JSON.stringify(body) })
export const unscheduleReport = (token: string, id: string) =>
  apiFetch(`/analytics/reports/${id}/schedule`, token, { method: 'DELETE' })
export const deleteReport = (token: string, id: string) =>
  apiFetch(`/analytics/reports/${id}`, token, { method: 'DELETE' })
export const listRuns = (token: string, id: string) => apiFetch<unknown[]>(`/analytics/reports/${id}/runs`, token)
