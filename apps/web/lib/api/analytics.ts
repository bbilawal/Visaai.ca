import type { MetricQuery, MetricResult } from '@visaai/types'
import { serverApi } from './server'
import { metricPath, qs } from './analytics-client'

/**
 * Server-side analytics reads (pages only — pulls next/headers via serverApi).
 *
 * Split out of analytics-client.ts because that module is imported by
 * `'use client'` components. A single `import { serverApi }` at its top level
 * put next/headers in the client graph and broke `next build` outright; the
 * dev server tolerated it, so it went unnoticed.
 *
 * Same split as iam.ts / iam-client.ts. Keep it: this is not a style choice.
 */
type Q = MetricQuery & { metric?: string }

export const fetchMetric = (key: string, q: Q) =>
  serverApi<MetricResult>(metricPath(key, q))

export const fetchSummary = (q: MetricQuery) =>
  serverApi<Record<string, MetricResult | { error: string }>>(
    `/analytics/summary?${qs(q)}`,
  )

export const fetchCatalog = () =>
  serverApi<{ key: string; supportedFilters: string[] }[]>(`/analytics/catalog`)
