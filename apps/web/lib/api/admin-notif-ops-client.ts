import { apiFetch } from './client'

/**
 * Re-enqueue a failed or dead delivery. Client-safe; the backend enforces
 * admin role (RolesGuard) — the caller must supply a valid admin access token.
 */
export const retryDelivery = (token: string, id: string) =>
  apiFetch<{ requeued: true }>(
    `/admin/notification-ops/deliveries/${encodeURIComponent(id)}/retry`,
    token,
    { method: 'POST' },
  )
