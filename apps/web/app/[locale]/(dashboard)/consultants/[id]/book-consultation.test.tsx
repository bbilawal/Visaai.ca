import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { getSession, listSlots, bookConsultation, toast, push } = vi.hoisted(() => ({
  getSession: vi.fn(),
  listSlots: vi.fn(),
  bookConsultation: vi.fn(),
  toast: vi.fn(),
  push: vi.fn(),
}))

vi.mock('@/lib/supabase/client', () => ({ getSession }))
vi.mock('@/lib/api/consultations-client', () => ({
  listSlots,
  bookConsultation,
  browserTimezone: () => 'Europe/London',
}))
vi.mock('@/components/providers/toast-provider', () => ({ useToast: () => ({ toast }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('next-intl', () => ({
  useTranslations: () => (k: string, v?: Record<string, unknown>) =>
    v ? `${k}:${Object.values(v).join(',')}` : k,
}))

import { BookConsultation } from './book-consultation'

const SLOTS = [
  { start: '2026-09-01T09:00:00.000Z', end: '2026-09-01T09:30:00.000Z' },
  { start: '2026-09-01T10:00:00.000Z', end: '2026-09-01T10:30:00.000Z' },
]

describe('BookConsultation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
    listSlots.mockResolvedValue({ timezone: 'America/Toronto', slots: SLOTS })
    bookConsultation.mockResolvedValue({ id: 'c1' })
  })

  it('renders the available slots', async () => {
    render(<BookConsultation consultantId="con-1" />)
    await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(2))
  })

  /**
   * The failure this protects against is a missed call. Slots are absolute
   * instants; rendering them in the CONSULTANT's zone shows someone in London a
   * Toronto wall-clock time with no indication it is not theirs.
   */
  it('shows times in the viewer’s timezone, not the consultant’s', async () => {
    render(<BookConsultation consultantId="con-1" />)
    await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(2))
    // 09:00Z is 10:00 in Europe/London (BST), and 05:00 in America/Toronto.
    expect(screen.getByText(/10:00/)).toBeTruthy()
    expect(screen.queryByText(/05:00/)).toBeNull()
  })

  it('tells the viewer when the consultant is in a different zone', async () => {
    render(<BookConsultation consultantId="con-1" />)
    await waitFor(() =>
      expect(screen.getByText(/consultantIsIn:America\/Toronto/)).toBeTruthy(),
    )
  })

  it('books the selected slot with the viewer’s timezone', async () => {
    render(<BookConsultation consultantId="con-1" applicationId="app-1" />)
    await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(2))

    await userEvent.click(screen.getAllByRole('radio')[1])
    await userEvent.click(screen.getByRole('button', { name: 'confirmBooking' }))

    await waitFor(() =>
      expect(bookConsultation).toHaveBeenCalledWith('tok', {
        consultantId: 'con-1',
        scheduledStart: SLOTS[1].start,
        scheduledEnd: SLOTS[1].end,
        timezone: 'Europe/London',
        applicationId: 'app-1',
      }),
    )
  })

  it('cannot confirm before a slot is chosen', async () => {
    render(<BookConsultation consultantId="con-1" />)
    await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(2))
    expect(
      screen.getByRole('button', { name: 'confirmBooking' }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it('surfaces a booking failure instead of pretending it worked', async () => {
    // The likely cause is a race: someone took the slot between list and click.
    // Silently navigating to an empty list would be the worst outcome.
    bookConsultation.mockRejectedValue(new Error('slot taken'))
    render(<BookConsultation consultantId="con-1" />)
    await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(2))

    await userEvent.click(screen.getAllByRole('radio')[0])
    await userEvent.click(screen.getByRole('button', { name: 'confirmBooking' }))

    await waitFor(() => expect(screen.getByText('slot taken')).toBeTruthy())
    expect(push).not.toHaveBeenCalled()
  })

  it('renders nothing bookable for a signed-out visitor', async () => {
    // Booking holds a real calendar slot, so it needs a real account. Showing a
    // control that will 401 is worse than showing none.
    getSession.mockResolvedValue({ data: { session: null } })
    render(<BookConsultation consultantId="con-1" />)
    await waitFor(() => expect(screen.getByText('noSlots')).toBeTruthy())
    expect(listSlots).not.toHaveBeenCalled()
  })

  it('degrades to "no slots" when availability cannot be loaded', async () => {
    listSlots.mockRejectedValue(new Error('boom'))
    render(<BookConsultation consultantId="con-1" />)
    await waitFor(() => expect(screen.getByText('noSlots')).toBeTruthy())
  })
})
