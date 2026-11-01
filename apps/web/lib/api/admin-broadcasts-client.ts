import { apiFetch } from './client'
import type { NotificationBroadcast, BroadcastInput } from '@visaai/types'

/**
 * Client-safe admin broadcast helper. Uses apiFetch only (no server.ts /
 * next/headers), so importable from client components. The backend re-checks
 * admin role server-side (RolesGuard) — this is not a security boundary.
 */
export const createBroadcast = (token: string, input: BroadcastInput) =>
  apiFetch<NotificationBroadcast>('/admin/broadcasts', token, {
    method: 'POST',
    body: JSON.stringify(input),
  })
