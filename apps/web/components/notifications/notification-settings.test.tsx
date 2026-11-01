/**
 * RTL tests for NotificationSettings (Task 7 — preferences UI).
 *
 * RED → GREEN cycle (TDD):
 *   1. Toggling a category checkbox calls updateNotificationPreferences with
 *      `categories` containing that category key.
 *   2. Changing the quiet-hours-start select calls it with `quiet_hours_start`.
 *   3. Changing the quiet-hours-end select calls it with `quiet_hours_end`.
 *   4. Changing the language select calls it with `language`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { NotificationPreferences } from '@visaai/types'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/notifications/push-manager', () => ({
  pushSupported: () => false,
  enablePush: vi.fn(),
  disablePush: vi.fn(),
}))

vi.mock('@/lib/api/push-client', () => ({
  subscribePush: vi.fn(),
  unsubscribePush: vi.fn(),
}))

const mockGetPrefs = vi.fn()
const mockUpdatePrefs = vi.fn()

vi.mock('@/lib/api/notification-preferences-client', () => ({
  getNotificationPreferences: (...args: unknown[]) => mockGetPrefs(...args),
  updateNotificationPreferences: (...args: unknown[]) => mockUpdatePrefs(...args),
}))

vi.mock('@/lib/supabase/client', () => ({
  getSession: () =>
    Promise.resolve({ data: { session: { access_token: 'test-token' } } }),
}))

vi.mock('next-intl', () => ({
  useTranslations: () =>
    (key: string) => key,
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_PREFS: NotificationPreferences = {
  user_id: 'u1',
  email_enabled: true,
  push_enabled: false,
  sms_enabled: false,
  categories: {},
  quiet_hours_start: null,
  quiet_hours_end: null,
  timezone: null,
  language: null,
  updated_at: new Date().toISOString(),
}

// ─── Import under test (after mocks) ─────────────────────────────────────────

// eslint-disable-next-line import/first
import { NotificationSettings } from './notification-settings'

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockGetPrefs.mockResolvedValue({ ...BASE_PREFS })
  mockUpdatePrefs.mockImplementation((_token: string, patch: Partial<NotificationPreferences>) =>
    Promise.resolve({ ...BASE_PREFS, ...patch }),
  )
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('NotificationSettings', () => {
  it('renders all category checkboxes after loading prefs', async () => {
    render(<NotificationSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('cat-application')).toBeInTheDocument()
      expect(screen.getByTestId('cat-billing')).toBeInTheDocument()
      expect(screen.getByTestId('cat-assignment')).toBeInTheDocument()
      expect(screen.getByTestId('cat-ai')).toBeInTheDocument()
      expect(screen.getByTestId('cat-support')).toBeInTheDocument()
      expect(screen.getByTestId('cat-system')).toBeInTheDocument()
    })
  })

  it('toggling a category calls updateNotificationPreferences with categories', async () => {
    render(<NotificationSettings />)
    await waitFor(() => expect(screen.getByTestId('cat-billing')).toBeInTheDocument())

    const checkbox = screen.getByTestId('cat-billing')
    expect(checkbox).toBeChecked() // default: absent = ON

    await act(async () => {
      fireEvent.click(checkbox)
    })

    await waitFor(() => {
      expect(mockUpdatePrefs).toHaveBeenCalledWith(
        'test-token',
        expect.objectContaining({ categories: expect.objectContaining({ billing: false }) }),
      )
    })
  })

  it('toggling SMS calls updateNotificationPreferences with sms_enabled', async () => {
    render(<NotificationSettings />)
    await waitFor(() => expect(screen.getByLabelText('sms')).toBeInTheDocument())

    await act(async () => {
      fireEvent.click(screen.getByLabelText('sms'))
    })

    await waitFor(() => {
      expect(mockUpdatePrefs).toHaveBeenCalledWith(
        'test-token',
        expect.objectContaining({ sms_enabled: true }),
      )
    })
  })

  it('changing quiet-hours start calls updateNotificationPreferences with quiet_hours_start', async () => {
    render(<NotificationSettings />)
    await waitFor(() => expect(screen.getByTestId('quiet-start')).toBeInTheDocument())

    await act(async () => {
      fireEvent.change(screen.getByTestId('quiet-start'), { target: { value: '22' } })
    })

    await waitFor(() => {
      expect(mockUpdatePrefs).toHaveBeenCalledWith(
        'test-token',
        expect.objectContaining({ quiet_hours_start: 22 }),
      )
    })
  })

  it('changing quiet-hours end calls updateNotificationPreferences with quiet_hours_end', async () => {
    render(<NotificationSettings />)
    await waitFor(() => expect(screen.getByTestId('quiet-end')).toBeInTheDocument())

    await act(async () => {
      fireEvent.change(screen.getByTestId('quiet-end'), { target: { value: '7' } })
    })

    await waitFor(() => {
      expect(mockUpdatePrefs).toHaveBeenCalledWith(
        'test-token',
        expect.objectContaining({ quiet_hours_end: 7 }),
      )
    })
  })

  it('selecting "off" for quiet-hours start sends null', async () => {
    const prefsWithQH = { ...BASE_PREFS, quiet_hours_start: 22, quiet_hours_end: 7 }
    mockGetPrefs.mockResolvedValue(prefsWithQH)
    mockUpdatePrefs.mockResolvedValue({ ...prefsWithQH, quiet_hours_start: null })

    render(<NotificationSettings />)
    await waitFor(() => expect(screen.getByTestId('quiet-start')).toBeInTheDocument())

    await act(async () => {
      fireEvent.change(screen.getByTestId('quiet-start'), { target: { value: '' } })
    })

    await waitFor(() => {
      expect(mockUpdatePrefs).toHaveBeenCalledWith(
        'test-token',
        expect.objectContaining({ quiet_hours_start: null }),
      )
    })
  })

  it('changing language select calls updateNotificationPreferences with language', async () => {
    render(<NotificationSettings />)
    await waitFor(() => expect(screen.getByTestId('pref-language')).toBeInTheDocument())

    await act(async () => {
      fireEvent.change(screen.getByTestId('pref-language'), { target: { value: 'fr' } })
    })

    await waitFor(() => {
      expect(mockUpdatePrefs).toHaveBeenCalledWith(
        'test-token',
        expect.objectContaining({ language: 'fr' }),
      )
    })
  })

  it('re-enabling a muted category sends true', async () => {
    const prefsWithMuted = { ...BASE_PREFS, categories: { application: false } }
    mockGetPrefs.mockResolvedValue(prefsWithMuted)
    mockUpdatePrefs.mockResolvedValue({ ...prefsWithMuted, categories: { application: true } })

    render(<NotificationSettings />)
    await waitFor(() => expect(screen.getByTestId('cat-application')).toBeInTheDocument())

    const checkbox = screen.getByTestId('cat-application')
    expect(checkbox).not.toBeChecked()

    await act(async () => {
      fireEvent.click(checkbox)
    })

    await waitFor(() => {
      expect(mockUpdatePrefs).toHaveBeenCalledWith(
        'test-token',
        expect.objectContaining({ categories: expect.objectContaining({ application: true }) }),
      )
    })
  })
})
