import { serverApi } from './server'
import type { NotificationBroadcast, NotificationBroadcastPage } from '@visaai/types'

/** Server-side only — reads broadcast history with the admin token via serverApi. */
export const getBroadcasts = (cursor?: string) => {
  const qs = new URLSearchParams()
  if (cursor) qs.set('cursor', cursor)
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return serverApi<NotificationBroadcastPage>(`/admin/broadcasts${suffix}`)
}

export const getBroadcast = (id: string) =>
  serverApi<NotificationBroadcast>(`/admin/broadcasts/${encodeURIComponent(id)}`)
