'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { Route } from 'next'
import type { NotificationFeedItem } from '@visaai/types'
import { Link, useRouter } from '@/i18n/navigation'
import { getSession, isGuestSession } from '@/lib/supabase/client'
import { useMessagingStream } from '@/lib/messaging/use-messaging-stream'
import {
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from '@/lib/api/notifications-client'

/** Map NotificationCategory → i18n key. */
const CATEGORY_KEY: Record<string, string> = {
  application: 'catApplication',
  billing: 'catBilling',
  assignment: 'catAssignment',
  ai: 'catAi',
  support: 'catSupport',
  system: 'catSystem',
}

/** Relative-time label (seconds → translated string). */
function useRelativeTime() {
  const t = useTranslations('notifications')
  return (iso: string): string => {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
    if (diff < 60) return t('justNow')
    if (diff < 3600) return t('minutesAgo', { n: String(Math.floor(diff / 60)) })
    if (diff < 86400) return t('hoursAgo', { n: String(Math.floor(diff / 3600)) })
    return t('daysAgo', { n: String(Math.floor(diff / 86400)) })
  }
}

/**
 * System notification bell. Shows an unread badge, polls every 30 s,
 * and opens a panel listing the notification feed.
 *
 * Mounted in the shared sidebar (components/layout/sidebar.tsx) so it
 * appears on every authenticated route (dashboard / admin / consultant).
 */
export function NotificationBell() {
  const t = useTranslations('notifications')
  const router = useRouter()
  const relativeTime = useRelativeTime()

  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [items, setItems] = useState<NotificationFeedItem[]>([])
  const [loading, setLoading] = useState(false)

  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // ── fetch helpers ──────────────────────────────────────────────────────────

  const fetchCount = useCallback(async () => {
    try {
      const { data: { session } } = await getSession()
      // A guest has a JWT but no notifications route it may call — polling one
      // every 30 s only produces 403s (BUG-002).
      if (!session || isGuestSession(session)) return
      const result = await getUnreadCount(session.access_token)
      setUnread(result.unread)
    } catch {
      // Network / auth error — leave current badge
    }
  }, [])

  const fetchItems = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { session } } = await getSession()
      if (!session || isGuestSession(session)) return
      const page = await getNotifications(session.access_token)
      setItems(page.rows)
      setUnread(page.unread)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  // ── effects ────────────────────────────────────────────────────────────────

  /**
   * Realtime: refresh on every SSE stream event (system emit() publishes a
   * `notification` event; message inserts publish message events). The bell
   * reflects new notifications without waiting for a poll.
   */
  useMessagingStream(() => {
    void fetchCount()
    if (open) void fetchItems()
  })

  /** Initial unread count + a slow fallback poll (SSE is the primary path). */
  useEffect(() => {
    void fetchCount()
    const id = setInterval(() => void fetchCount(), 120_000)
    return () => clearInterval(id)
  }, [fetchCount])

  /** Fetch feed items whenever the panel is opened. */
  useEffect(() => {
    if (open) void fetchItems()
  }, [open, fetchItems])

  /** Close panel on outside click. */
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // ── actions ────────────────────────────────────────────────────────────────

  const handleItemClick = async (id: string) => {
    try {
      const { data: { session } } = await getSession()
      if (!session) return
      await markNotificationRead(session.access_token, id)
      setItems(prev =>
        prev.map(n =>
          n.id === id ? { ...n, readAt: new Date().toISOString() } : n,
        ),
      )
      setUnread(prev => Math.max(0, prev - 1))
      setOpen(false)
    } catch {
      // silent
    }
  }

  const handleMarkAll = async () => {
    try {
      const { data: { session } } = await getSession()
      if (!session) return
      await markAllNotificationsRead(session.access_token)
      const now = new Date().toISOString()
      setItems(prev => prev.map(n => ({ ...n, readAt: n.readAt ?? now })))
      setUnread(0)
      router.refresh()
    } catch {
      // silent
    }
  }

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="relative">
      {/* ── Bell button ── */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={`${t('title')}${unread > 0 ? `, ${unread} unread` : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative rounded p-2 text-midtone-gray hover:text-rich-black hover:bg-ghost-gray focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-black focus-visible:ring-offset-1 transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>

        {unread > 0 && (
          <span
            data-testid="unread-badge"
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium"
            style={{
              background: 'var(--color-rose)',
              color: 'var(--color-paper-canvas)',
            }}
            aria-hidden="true"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* ── Notification panel ── */}
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={t('title')}
          className="absolute left-full top-0 ms-2 z-50 w-80 rounded-xl border border-[rgba(0,0,0,.15)] bg-canvas-white shadow-lg overflow-hidden"
          style={{ maxHeight: '70vh' }}
        >
          {/* Panel header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(0,0,0,.15)]">
            <h2 className="text-[14px] font-semibold text-deep-black">
              {t('title')}
            </h2>
            {items.length > 0 && (
              <button
                type="button"
                onClick={() => void handleMarkAll()}
                className="text-[12px] text-midtone-gray hover:text-rich-black focus-visible:outline-none focus-visible:underline transition-colors cursor-pointer"
              >
                {t('markAll')}
              </button>
            )}
          </div>

          {/* Panel body */}
          <ul
            className="overflow-y-auto divide-y divide-[rgba(0,0,0,.08)]"
            style={{ maxHeight: 'calc(70vh - 3.25rem)' }}
          >
            {loading && (
              <li className="px-4 py-6 text-center text-[13px] text-midtone-gray">
                {t('loading')}
              </li>
            )}

            {!loading && items.length === 0 && (
              <li className="px-4 py-8 text-center text-[13px] text-midtone-gray">
                {t('empty')}
              </li>
            )}

            {!loading &&
              items.map(item => (
                <li
                  key={item.id}
                  className={!item.readAt ? 'bg-[#cfdaf5]/10' : undefined}
                >
                  <Link
                    href={(item.link ?? '/') as Route}
                    onClick={() => void handleItemClick(item.id)}
                    className="block px-4 py-3 hover:bg-ghost-gray focus-visible:outline-none focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-deep-black transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="inline-flex items-center text-[10px] font-medium rounded-full px-2 py-0.5 bg-ghost-gray text-midtone-gray">
                        {t(CATEGORY_KEY[item.category] ?? 'catSystem')}
                      </span>
                      <span className="text-[11px] text-midtone-gray shrink-0">
                        {relativeTime(item.createdAt)}
                      </span>
                    </div>
                    {item.title && (
                      <p className="text-[13px] font-medium text-deep-black line-clamp-1">
                        {item.title}
                      </p>
                    )}
                    {item.body && (
                      <p className="mt-0.5 text-[12px] text-midtone-gray line-clamp-2">
                        {item.body}
                      </p>
                    )}
                  </Link>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  )
}
