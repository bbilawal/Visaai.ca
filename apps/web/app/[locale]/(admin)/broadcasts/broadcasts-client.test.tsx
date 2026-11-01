/**
 * RTL tests for BroadcastsClient (Task 4 — admin broadcast composer + history).
 *
 * RED → GREEN cycle:
 *   1. Filling title/body + choosing an audience kind + clicking Send opens the
 *      in-page confirm WITHOUT calling createBroadcast.
 *   2. Only confirming the send calls the mocked createBroadcast with the right
 *      payload (title/body/category/audience) + router.refresh.
 *   3. Cancelling the confirm does NOT call createBroadcast.
 *   4. Switching the audience kind to 'Role' reveals the role select and sends a
 *      { kind: 'role', role } audience.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockRefresh = vi.fn()

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

const mockCreateBroadcast = vi.fn().mockResolvedValue({ id: 'new-broadcast' })

vi.mock('@/lib/api/admin-broadcasts-client', () => ({
  createBroadcast: (...args: unknown[]) => mockCreateBroadcast(...args),
}))

vi.mock('@/lib/supabase/client', () => ({
  getSession: () =>
    Promise.resolve({ data: { session: { access_token: 'test-token' } } }),
}))

// next-intl: return the translation key so assertions are deterministic
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

// ── Import after mocks ────────────────────────────────────────────────────────
// eslint-disable-next-line import/first
import { BroadcastsClient } from './broadcasts-client'

// ── Helpers ─────────────────────────────────────────────────────────────────

function fillComposer(title = 'Scheduled maintenance', body = 'We will be down at 2am.') {
  fireEvent.change(screen.getByTestId('broadcast-title'), { target: { value: title } })
  fireEvent.change(screen.getByTestId('broadcast-body'), { target: { value: body } })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BroadcastsClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the composer fields and the send button', () => {
    render(<BroadcastsClient initialBroadcasts={[]} />)
    expect(screen.getByTestId('broadcast-title')).toBeInTheDocument()
    expect(screen.getByTestId('broadcast-body')).toBeInTheDocument()
    expect(screen.getByTestId('audience-kind')).toBeInTheDocument()
    expect(screen.getByTestId('send-btn')).toBeInTheDocument()
  })

  it('clicking Send opens the confirm WITHOUT calling createBroadcast', async () => {
    render(<BroadcastsClient initialBroadcasts={[]} />)
    fillComposer()

    await act(async () => {
      fireEvent.click(screen.getByTestId('send-btn'))
    })

    expect(screen.getByTestId('confirm-panel')).toBeInTheDocument()
    expect(mockCreateBroadcast).not.toHaveBeenCalled()
  })

  it('confirming the send calls createBroadcast with the right payload (default: all users)', async () => {
    render(<BroadcastsClient initialBroadcasts={[]} />)
    fillComposer('Big news', 'Everyone should read this.')

    await act(async () => {
      fireEvent.click(screen.getByTestId('send-btn'))
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-send-btn'))
    })

    await waitFor(() => {
      expect(mockCreateBroadcast).toHaveBeenCalledWith(
        'test-token',
        expect.objectContaining({
          title: 'Big news',
          body: 'Everyone should read this.',
          category: 'system',
          audience: { kind: 'all' },
        }),
      )
      expect(mockRefresh).toHaveBeenCalled()
    })
  })

  it('cancelling the confirm does NOT call createBroadcast', async () => {
    render(<BroadcastsClient initialBroadcasts={[]} />)
    fillComposer()

    await act(async () => {
      fireEvent.click(screen.getByTestId('send-btn'))
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('cancel-send-btn'))
    })

    expect(mockCreateBroadcast).not.toHaveBeenCalled()
    expect(screen.queryByTestId('confirm-panel')).not.toBeInTheDocument()
  })

  it('switching audience kind to Role reveals the role select and sends a role audience', async () => {
    render(<BroadcastsClient initialBroadcasts={[]} />)
    fillComposer()

    // Role select is hidden by default
    expect(screen.queryByTestId('audience-role')).not.toBeInTheDocument()

    fireEvent.change(screen.getByTestId('audience-kind'), { target: { value: 'role' } })

    const roleSelect = screen.getByTestId('audience-role')
    expect(roleSelect).toBeInTheDocument()
    fireEvent.change(roleSelect, { target: { value: 'consultant' } })

    await act(async () => {
      fireEvent.click(screen.getByTestId('send-btn'))
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-send-btn'))
    })

    await waitFor(() => {
      expect(mockCreateBroadcast).toHaveBeenCalledWith(
        'test-token',
        expect.objectContaining({
          audience: { kind: 'role', role: 'consultant' },
        }),
      )
    })
  })

  it('switching audience kind to Specific users reveals the ids textarea and parses ids', async () => {
    render(<BroadcastsClient initialBroadcasts={[]} />)
    fillComposer()

    fireEvent.change(screen.getByTestId('audience-kind'), { target: { value: 'users' } })

    const idsInput = screen.getByTestId('audience-userids')
    expect(idsInput).toBeInTheDocument()
    fireEvent.change(idsInput, { target: { value: 'id-a, id-b\nid-c' } })

    await act(async () => {
      fireEvent.click(screen.getByTestId('send-btn'))
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-send-btn'))
    })

    await waitFor(() => {
      expect(mockCreateBroadcast).toHaveBeenCalledWith(
        'test-token',
        expect.objectContaining({
          audience: { kind: 'users', userIds: ['id-a', 'id-b', 'id-c'] },
        }),
      )
    })
  })

  it('renders broadcast history rows', () => {
    render(
      <BroadcastsClient
        initialBroadcasts={[
          {
            id: 'b1',
            title: 'Past announcement',
            body: 'old body',
            link: null,
            category: 'system',
            audience: { kind: 'all' },
            status: 'sent',
            recipient_count: 42,
            created_at: '2026-01-01T00:00:00Z',
            completed_at: '2026-01-01T00:01:00Z',
          },
        ]}
      />,
    )
    expect(screen.getByText('Past announcement')).toBeInTheDocument()
    expect(screen.getByText(/42/)).toBeInTheDocument()
  })
})
