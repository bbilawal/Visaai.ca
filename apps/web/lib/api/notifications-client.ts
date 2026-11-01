import { apiFetch } from './client'
import type { NotificationFeedPage } from '@visaai/types'

/**
 * Client-safe notification API functions. Uses apiFetch ONLY (no server.ts /
 * next/headers) so they are importable from client components. The backend
 * re-checks ownership + JWT server-side (JwtGuard) — this is not a security boundary.
 *
 * Routes:
 *   GET  /notifications?cursor=&limit=        → NotificationFeedPage
 *   GET  /notifications/unread-count          → { unread: number }
 *   POST /notifications/:id/read              → void
 *   POST /notifications/read-all              → void
 */

/** Paginated notification feed (newest first). */
export const getNotifications = (token: string, cursor?: string) =>
  apiFetch<NotificationFeedPage>(
    `/notifications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    token,
  )

/** Current unread count (fast; no feed rows). */
export const getUnreadCount = (token: string) =>
  apiFetch<{ unread: number }>('/notifications/unread-count', token)

/** Mark a single notification as read. */
export const markNotificationRead = (token: string, id: string) =>
  apiFetch<void>(`/notifications/${encodeURIComponent(id)}/read`, token, {
    method: 'POST',
  })

/** Mark all notifications as read. */
export const markAllNotificationsRead = (token: string) =>
  apiFetch<void>('/notifications/read-all', token, { method: 'POST' })
