/**
 * RTL tests for NotificationBell (Task 7 — system notification center).
 *
 * RED → GREEN cycle:
 *   1. Renders the unread badge from a mocked getUnreadCount
 *   2. Opening the panel shows items from a mocked getNotifications
 *   3. Clicking an item calls the mocked markNotificationRead
 *   4. "Mark all" button calls markAllNotificationsRead
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { NotificationFeedPage } from '@visaai/types'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRefresh = vi.fn()

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    onClick,
    children,
    className,
  }: {
    href: unknown
    onClick?: React.MouseEventHandler<HTMLAnchorElement>
    children: React.ReactNode
    className?: string
  }) => (
    <a href={String(href)} onClick={onClick} className={className}>
      {children}
    </a>
  ),
  useRouter: () => ({ refresh: mockRefresh }),
}))

const mockGetUnreadCount = vi.fn()
const mockGetNotifications = vi.fn()
const mockMarkNotificationRead = vi.fn()
const mockMarkAllNotificationsRead = vi.fn()

vi.mock('@/lib/api/notifications-client', () => ({
  getUnreadCount: (...args: unknown[]) => mockGetUnreadCount(...args),
  getNotifications: (...args: unknown[]) => mockGetNotifications(...args),
  markNotificationRead: (...args: unknown[]) => mockMarkNotificationRead(...args),
  markAllNotificationsRead: (...args: unknown[]) => mockMarkAllNotificationsRead(...args),
}))

// Capture the SSE stream callback so tests can simulate a live event.
const streamHoist = vi.hoisted(() => ({ cb: null as null | (() => void) }))
vi.mock('@/lib/messaging/use-messaging-stream', () => ({
  useMessagingStream: (cb: () => void) => {
    streamHoist.cb = cb
  },
}))

// The bell only fetches for a permanent identity (BUG-002), so the fake session
// carries a user. isGuestSession stays real so the shipped predicate is what
// decides.
const sessionHoist = vi.hoisted(() => ({ isAnonymous: false }))
vi.mock('@/lib/supabase/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase/client')>()),
  getSession: () =>
    Promise.resolve({
      data: {
        session: {
          access_token: 'test-token',
          user: { id: 'u1', is_anonymous: sessionHoist.isAnonymous },
        },
      },
    }),
}))

vi.mock('next-intl', () => ({
  useTranslations: () =>
    (key: string, values?: Record<string, unknown>) => {
      if (values) {
        return Object.entries(values).reduce(
          (s, [k, v]) => s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v)),
          key,
        )
      }
      return key
    },
}))

// ─── Import under test (after mocks) ─────────────────────────────────────────
// eslint-disable-next-line import/first
import { NotificationBell } from './notification-bell'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FEED_PAGE: NotificationFeedPage = {
  rows: [
    {
      id: 'n1',
      type: 'consultant.assigned',
      category: 'assignment',
      title: 'Consultant assigned',
      body: 'A consultant has been assigned to your application.',
      link: '/applications/app1',
      data: {},
      readAt: null,
      createdAt: new Date(Date.now() - 300_000).toISOString(),
    },
    {
      id: 'n2',
      type: 'payment.received',
      category: 'billing',
      title: 'Payment received',
      body: 'Your payment was processed.',
      link: '/billing',
      data: {},
      readAt: new Date().toISOString(),
      createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    },
  ],
  unread: 1,
  nextCursor: null,
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  sessionHoist.isAnonymous = false
  mockGetUnreadCount.mockResolvedValue({ unread: 3 })
  mockGetNotifications.mockResolvedValue(FEED_PAGE)
  mockMarkNotificationRead.mockResolvedValue(undefined)
  mockMarkAllNotificationsRead.mockResolvedValue(undefined)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('NotificationBell', () => {
  it('renders the unread badge from getUnreadCount', async () => {
    render(<NotificationBell />)

    await waitFor(() => {
      expect(screen.getByTestId('unread-badge')).toBeInTheDocument()
    })

    expect(screen.getByTestId('unread-badge')).toHaveTextContent('3')
    expect(mockGetUnreadCount).toHaveBeenCalledWith('test-token')
  })

  it('opening the panel shows items from getNotifications', async () => {
    render(<NotificationBell />)

    // Wait for initial mount to settle
    await waitFor(() => expect(mockGetUnreadCount).toHaveBeenCalled())

    // Open the panel
    const bell = screen.getByRole('button')
    await act(async () => {
      fireEvent.click(bell)
    })

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    expect(mockGetNotifications).toHaveBeenCalledWith('test-token')

    await waitFor(() => {
      expect(screen.getByText('Consultant assigned')).toBeInTheDocument()
      expect(screen.getByText('Payment received')).toBeInTheDocument()
    })
  })

  it('clicking an item calls markNotificationRead with the item id', async () => {
    render(<NotificationBell />)

    await waitFor(() => expect(mockGetUnreadCount).toHaveBeenCalled())

    // Open panel
    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })

    await waitFor(() => {
      expect(screen.getByText('Consultant assigned')).toBeInTheDocument()
    })

    // Click the first item link
    const link = screen.getByRole('link', { name: /Consultant assigned/i })
    await act(async () => {
      fireEvent.click(link)
    })

    await waitFor(() => {
      expect(mockMarkNotificationRead).toHaveBeenCalledWith('test-token', 'n1')
    })
  })

  it('"mark all" button calls markAllNotificationsRead', async () => {
    render(<NotificationBell />)

    await waitFor(() => expect(mockGetUnreadCount).toHaveBeenCalled())

    // Open panel
    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })

    await waitFor(() => {
      // The mark-all button uses the 'markAll' translation key (mock returns key)
      expect(screen.getByText('markAll')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByText('markAll'))
    })

    await waitFor(() => {
      expect(mockMarkAllNotificationsRead).toHaveBeenCalledWith('test-token')
    })
  })

  it('refetches the unread count when a live SSE notification event fires', async () => {
    render(<NotificationBell />)

    await waitFor(() => expect(mockGetUnreadCount).toHaveBeenCalledTimes(1))
    expect(streamHoist.cb).toBeTypeOf('function')

    await act(async () => {
      streamHoist.cb?.()
    })

    await waitFor(() => expect(mockGetUnreadCount).toHaveBeenCalledTimes(2))
  })

  it('shows the empty state when there are no items', async () => {
    mockGetNotifications.mockResolvedValue({
      rows: [],
      unread: 0,
      nextCursor: null,
    })

    render(<NotificationBell />)

    await waitFor(() => expect(mockGetUnreadCount).toHaveBeenCalled())

    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })

    await waitFor(() => {
      // 'empty' is the i18n key returned by the mock translator
      expect(screen.getByText('empty')).toBeInTheDocument()
    })
  })

  // BUG-002: a guest holds a JWT but the notifications routes are not
  // @AllowAnonymous, so every poll was a guaranteed 403.
  it('never calls the notifications API for a guest session', async () => {
    sessionHoist.isAnonymous = true

    render(<NotificationBell />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })

    expect(mockGetUnreadCount).not.toHaveBeenCalled()
    expect(mockGetNotifications).not.toHaveBeenCalled()
  })
})
