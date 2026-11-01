import type { PushSubscriptionRecord } from '@visaai/types'
import { apiFetch } from './client'
import type { SerializedSubscription } from '../notifications/push-manager'

export const subscribePush = (token: string, sub: SerializedSubscription, userAgent: string) =>
  apiFetch<PushSubscriptionRecord>('/notifications/push/subscribe', token, {
    method: 'POST',
    body: JSON.stringify({ ...sub, userAgent }),
  })

export const unsubscribePush = (token: string, endpoint: string) =>
  apiFetch<{ ok: true }>('/notifications/push/subscribe', token, {
    method: 'DELETE',
    body: JSON.stringify({ endpoint }),
  })
