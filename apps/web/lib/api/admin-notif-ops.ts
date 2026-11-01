import { serverApi } from './server'
import type { NotificationOpsMetrics, NotificationOpsRange, FailedDeliveryPage } from '@visaai/types'

/** Fetch ops metrics for the given time range. Server-only. */
export const getOpsMetrics = (range: NotificationOpsRange) =>
  serverApi<NotificationOpsMetrics>(`/admin/notification-ops/metrics?range=${range}`)

/** Fetch the first page of failed/dead deliveries, optionally from a cursor. Server-only. */
export const getFailedDeliveries = (cursor?: string) => {
  const qs = new URLSearchParams()
  if (cursor) qs.set('cursor', cursor)
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return serverApi<FailedDeliveryPage>(`/admin/notification-ops/failed${suffix}`)
}
