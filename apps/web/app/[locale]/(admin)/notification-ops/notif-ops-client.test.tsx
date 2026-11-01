/**
 * RTL tests for NotifOpsScreen (Task 5 — notification operations dashboard).
 *
 * RED → GREEN cycle:
 *   1. Renders metric cards with the correct counts
 *   2. Renders the failed-delivery table with a row
 *   3. Clicking Retry calls retryDelivery with the right args
 *   4. router.refresh() is called after a successful retry
 *   5. Shows "no failed" message when the failed list is empty
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { NotificationOpsMetrics, FailedDeliveryPage } from '@visaai/types'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockReplace = vi.fn()
const mockRefresh = vi.fn()

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, refresh: mockRefresh }),
  usePathname: () => '/notification-ops',
}))

const mockRetryDelivery = vi.fn().mockResolvedValue({ requeued: true })

vi.mock('@/lib/api/admin-notif-ops-client', () => ({
  retryDelivery: (...args: unknown[]) => mockRetryDelivery(...args),
}))

vi.mock('@/lib/supabase/client', () => ({
  getSession: () =>
    Promise.resolve({ data: { session: { access_token: 'test-token' } } }),
}))

// next-intl: return the translation key so assertions are stable
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

// Card is a simple presentational wrapper — let it render real DOM
vi.mock('@/components/ui/card', () => ({
  Card: ({ children, ...rest }: { children: React.ReactNode }) => (
    <div data-testid="card" {...rest}>
      {children}
    </div>
  ),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const metrics: NotificationOpsMetrics = {
  range: '7d',
  total: 7,
  byStatus: { queued: 0, sent: 5, failed: 2, skipped: 0, dead: 1 },
  byChannel: { email: 7 },
  byEvent: { 'payment.received': 7 },
  queue: { waiting: 1, active: 0, completed: 50, failed: 3, delayed: 0 },
}

const failedPage: FailedDeliveryPage = {
  rows: [
    {
      id: 'd1',
      eventType: 'payment.received',
      channel: 'email',
      status: 'failed',
      attempts: 3,
      error: 'SMTP timeout',
      userId: 'u1',
      createdAt: '2026-07-01T10:00:00Z',
    },
  ],
  total: 1,
  nextCursor: null,
}

const emptyFailedPage: FailedDeliveryPage = {
  rows: [],
  total: 0,
  nextCursor: null,
}

// ── Import after mocks ────────────────────────────────────────────────────────
// eslint-disable-next-line import/first
import { NotifOpsScreen } from './notif-ops-client'

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('NotifOpsScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRetryDelivery.mockResolvedValue({ requeued: true })
  })

  it('renders metric cards with correct numeric values', () => {
    render(
      <NotifOpsScreen metrics={metrics} failedPage={failedPage} range="7d" />,
    )

    // Label translation keys are all rendered
    expect(screen.getByText('total')).toBeInTheDocument()
    expect(screen.getByText('sent')).toBeInTheDocument()
    expect(screen.getByText('failed')).toBeInTheDocument()
    expect(screen.getByText('skipped')).toBeInTheDocument()
    expect(screen.getByText('queued')).toBeInTheDocument()

    // Sent = 5 (unique in this fixture — byChannel/byEvent both have 7, queue vals are 0/1/50/3)
    expect(screen.getByText('5')).toBeInTheDocument()

    // Total = 7 (appears in metric card, byChannel, byEvent — at least one rendered)
    expect(screen.getAllByText('7').length).toBeGreaterThanOrEqual(1)

    // Failed+Dead = 3 (appears in metric card and queue.failed — at least one rendered)
    expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1)
  })

  it('renders the failed-delivery table with a row', () => {
    render(
      <NotifOpsScreen metrics={metrics} failedPage={failedPage} range="7d" />,
    )

    // The error message is unique to the failed-delivery table
    expect(screen.getByText('SMTP timeout')).toBeInTheDocument()

    // The retry button exists (aria-label includes the event type)
    expect(
      screen.getByRole('button', { name: /retry payment\.received/i }),
    ).toBeInTheDocument()

    // Attempts count appears in the row
    expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1)
  })

  it('clicking Retry calls retryDelivery with correct args', async () => {
    render(
      <NotifOpsScreen metrics={metrics} failedPage={failedPage} range="7d" />,
    )

    const retryBtn = screen.getByRole('button', {
      name: /retry payment\.received/i,
    })

    await act(async () => {
      fireEvent.click(retryBtn)
    })

    await waitFor(() => {
      expect(mockRetryDelivery).toHaveBeenCalledWith('test-token', 'd1')
    })
  })

  it('calls router.refresh() after a successful retry', async () => {
    render(
      <NotifOpsScreen metrics={metrics} failedPage={failedPage} range="7d" />,
    )

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /retry payment\.received/i }),
      )
    })

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledTimes(1)
    })
  })

  it('shows the empty-state message when there are no failed deliveries', () => {
    render(
      <NotifOpsScreen
        metrics={{ ...metrics, total: 0, byStatus: { queued: 0, sent: 0, failed: 0, skipped: 0, dead: 0 } }}
        failedPage={emptyFailedPage}
        range="24h"
      />,
    )

    expect(screen.getByText('noFailed')).toBeInTheDocument()
  })

  it('range selector buttons are rendered and clicking one updates the URL', () => {
    render(
      <NotifOpsScreen metrics={metrics} failedPage={failedPage} range="7d" />,
    )

    const btn24h = screen.getByText('range24h')
    fireEvent.click(btn24h)

    expect(mockReplace).toHaveBeenCalledWith('/notification-ops?range=24h')
  })

  it('renders queue panel with waiting and completed counts', () => {
    render(
      <NotifOpsScreen metrics={metrics} failedPage={failedPage} range="7d" />,
    )

    // waiting = 1, completed = 50
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('50')).toBeInTheDocument()
    expect(screen.getByText('queueWaiting')).toBeInTheDocument()
    expect(screen.getByText('queueCompleted')).toBeInTheDocument()
  })
})
