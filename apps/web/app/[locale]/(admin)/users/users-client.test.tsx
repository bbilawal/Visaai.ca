/**
 * RTL tests for UsersTable (Task 7 — admin user list).
 *
 * RED → GREEN cycle:
 *   1. Renders rows with status badges
 *   2. Selecting a non-self row enables the bulk bar
 *   3. "Soft delete" bulk button opens the in-page confirm dialog
 *   4. bulkUsers is only called AFTER confirming (not on open)
 *   5. The current-user row's checkbox is disabled
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { AdminUserListResult, AdminUserView } from '@visaai/types'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockReplace = vi.fn()
const mockRefresh = vi.fn()

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, refresh: mockRefresh }),
  usePathname: () => '/users',
  Link: ({ href, children }: { href: unknown; children: React.ReactNode }) => (
    <a href={String(href)}>{children}</a>
  ),
}))

const mockBulkUsers = vi.fn().mockResolvedValue({ succeeded: [], skipped: [] })

vi.mock('@/lib/api/admin-client', () => ({
  bulkUsers: (...args: unknown[]) => mockBulkUsers(...args),
  setUserRole: vi.fn().mockResolvedValue({}),
  getConsultantCountries: vi.fn().mockResolvedValue({ codes: [] }),
  setConsultantCountries: vi.fn().mockResolvedValue({ codes: [] }),
}))

vi.mock('@/lib/supabase/client', () => ({
  getSession: () =>
    Promise.resolve({ data: { session: { access_token: 't' } } }),
}))

// next-intl: return the translation key so assertions are deterministic
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (values) {
      let result = key
      for (const [k, v] of Object.entries(values)) {
        result = result.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
      }
      return result
    }
    return key
  },
}))

// Stub heavy UI deps that aren't under test
vi.mock('@/components/ui/searchable-select', () => ({
  SearchableSelect: () => null,
}))

vi.mock('@/components/ui/country-flag', () => ({
  CountryFlag: () => null,
}))

vi.mock('@/lib/use-supported-countries', () => ({
  useSupportedCountries: () => ({ countries: [], loading: false, error: null }),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const rows: AdminUserView[] = [
  {
    id: 'u1',
    email: 'alice@x.com',
    fullName: 'Alice',
    status: 'active',
    appRole: 'user',
    roles: [],
    lastSignInAt: null,
    bannedUntil: null,
    createdAt: '2024-01-01',
  },
  {
    id: 'u2',
    email: 'bob@x.com',
    fullName: 'Bob',
    status: 'suspended',
    appRole: 'user',
    roles: [],
    lastSignInAt: null,
    bannedUntil: null,
    createdAt: '2024-01-01',
  },
  {
    id: 'me',
    email: 'me@x.com',
    fullName: 'Admin Me',
    status: 'active',
    appRole: 'admin',
    roles: [],
    lastSignInAt: null,
    bannedUntil: null,
    createdAt: '2024-01-01',
  },
]

const result: AdminUserListResult = { rows, total: 3 }

const params = { q: '', status: '', page: 1, sort: '', pageSize: 25 }

const SELF_ID = 'me'

// ── Import after mocks ────────────────────────────────────────────────────────
// eslint-disable-next-line import/first
import { UsersTable } from './users-client'

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('UsersTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders rows with status badges for active and suspended users', () => {
    render(<UsersTable result={result} params={params} currentUserId={SELF_ID} />)

    // Emails present
    expect(screen.getByText('alice@x.com')).toBeInTheDocument()
    expect(screen.getByText('bob@x.com')).toBeInTheDocument()

    // Status badge translation keys rendered (mock returns key)
    const activeBadges = screen.getAllByText('statusActive')
    expect(activeBadges.length).toBeGreaterThanOrEqual(1)

    const suspendedBadges = screen.getAllByText('statusSuspended')
    expect(suspendedBadges.length).toBeGreaterThanOrEqual(1)
  })

  it('selecting a non-self row makes the bulk action bar appear', () => {
    render(<UsersTable result={result} params={params} currentUserId={SELF_ID} />)

    // Bulk bar should not be visible yet
    expect(screen.queryByRole('toolbar', { name: /bulk actions/i })).not.toBeInTheDocument()

    // Select alice (non-self)
    const aliceCheckbox = screen.getByRole('checkbox', { name: 'Select alice@x.com' })
    fireEvent.click(aliceCheckbox)

    // Bulk bar should now appear
    expect(screen.getByRole('toolbar', { name: /bulk actions/i })).toBeInTheDocument()
  })

  it('clicking Soft delete opens the confirm dialog without calling bulkUsers', () => {
    render(<UsersTable result={result} params={params} currentUserId={SELF_ID} />)

    // Select alice
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select alice@x.com' }))

    // Click soft delete
    fireEvent.click(screen.getByText('bulkSoftDelete'))

    // Confirm dialog should appear
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // bulkUsers must NOT have been called yet
    expect(mockBulkUsers).not.toHaveBeenCalled()
  })

  it('bulkUsers is called with the right args only after clicking confirm', async () => {
    render(<UsersTable result={result} params={params} currentUserId={SELF_ID} />)

    // Select alice
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select alice@x.com' }))

    // Open confirm
    fireEvent.click(screen.getByText('bulkSoftDelete'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(mockBulkUsers).not.toHaveBeenCalled()

    // Confirm
    await act(async () => {
      fireEvent.click(screen.getByText('confirmProceed'))
    })

    await waitFor(() => {
      expect(mockBulkUsers).toHaveBeenCalledWith('t', 'soft-delete', ['u1'], undefined)
    })
  })

  it('the current-user row checkbox is disabled', () => {
    render(<UsersTable result={result} params={params} currentUserId={SELF_ID} />)

    const selfCheckbox = screen.getByRole('checkbox', { name: 'Select me@x.com' })
    expect(selfCheckbox).toBeDisabled()
  })

  it('non-self checkboxes are enabled', () => {
    render(<UsersTable result={result} params={params} currentUserId={SELF_ID} />)

    const aliceCheckbox = screen.getByRole('checkbox', { name: 'Select alice@x.com' })
    const bobCheckbox = screen.getByRole('checkbox', { name: 'Select bob@x.com' })

    expect(aliceCheckbox).not.toBeDisabled()
    expect(bobCheckbox).not.toBeDisabled()
  })

  it('cancelling confirm closes the dialog without calling bulkUsers', () => {
    render(<UsersTable result={result} params={params} currentUserId={SELF_ID} />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select alice@x.com' }))
    fireEvent.click(screen.getByText('bulkSoftDelete'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByText('confirmCancel'))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockBulkUsers).not.toHaveBeenCalled()
  })
})
