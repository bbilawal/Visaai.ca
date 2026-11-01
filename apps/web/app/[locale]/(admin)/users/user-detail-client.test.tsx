/**
 * RTL tests for UserDetailClient (Task 8 — admin user detail).
 *
 * RED → GREEN cycle:
 *   1. Status panel / status badge renders (identity info visible)
 *   2. Clicking Suspend opens focus-trapped confirm dialog; only CONFIRMING calls suspendUser
 *   3. Self-account suspend button is disabled (isSelf guard)
 *   4. Adding a role (via select) calls grantUserRole
 *   5. Removing a role chip (×) calls revokeUserRole
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { AdminUserDetail } from '@visaai/types'
import type { RoleCatalogEntry } from '@/lib/api/admin'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockRefresh = vi.fn()
const mockReplace = vi.fn()

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, replace: mockReplace }),
  Link: ({ href, children }: { href: unknown; children: React.ReactNode }) => (
    <a href={String(href)}>{children}</a>
  ),
}))

const mockSuspendUser = vi.fn().mockResolvedValue({ id: 'u1', status: 'suspended' })
const mockReactivateUser = vi.fn().mockResolvedValue({ id: 'u1', status: 'active' })
const mockSoftDeleteUser = vi.fn().mockResolvedValue({ id: 'u1', status: 'deleted' })
const mockRestoreUser = vi.fn().mockResolvedValue({ id: 'u1', status: 'active' })
const mockResetUserPassword = vi.fn().mockResolvedValue({ issued: true })
const mockGrantUserRole = vi.fn().mockResolvedValue({ granted: true })
const mockRevokeUserRole = vi.fn().mockResolvedValue({ revoked: true })

vi.mock('@/lib/api/admin-client', () => ({
  suspendUser: (...args: unknown[]) => mockSuspendUser(...args),
  reactivateUser: (...args: unknown[]) => mockReactivateUser(...args),
  softDeleteUser: (...args: unknown[]) => mockSoftDeleteUser(...args),
  restoreUser: (...args: unknown[]) => mockRestoreUser(...args),
  resetUserPassword: (...args: unknown[]) => mockResetUserPassword(...args),
  grantUserRole: (...args: unknown[]) => mockGrantUserRole(...args),
  revokeUserRole: (...args: unknown[]) => mockRevokeUserRole(...args),
  // re-exports used by users-client
  bulkUsers: vi.fn().mockResolvedValue({ succeeded: [], skipped: [] }),
  setUserRole: vi.fn().mockResolvedValue({}),
  getConsultantCountries: vi.fn().mockResolvedValue({ codes: [] }),
  setConsultantCountries: vi.fn().mockResolvedValue({ codes: [] }),
}))

vi.mock('@/lib/supabase/client', () => ({
  getSession: () =>
    Promise.resolve({ data: { session: { access_token: 'test-token' } } }),
}))

// next-intl: return key (deterministic assertions)
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (values) {
      let r = key
      for (const [k, v] of Object.entries(values)) {
        r = r.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
      }
      return r
    }
    return key
  },
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseDetail: AdminUserDetail = {
  id: 'u1',
  email: 'alice@test.com',
  fullName: 'Alice Tester',
  status: 'active',
  appRole: 'user',
  roles: ['iam.viewer'],
  lastSignInAt: '2024-06-01T10:00:00Z',
  bannedUntil: null,
  createdAt: '2024-01-01T00:00:00Z',
  nationality: 'CA',
  emailConfirmedAt: '2024-01-01T00:01:00Z',
  statusReason: null,
  statusChangedAt: null,
  applicationsCount: 3,
  recentAuth: [
    { id: 'a1', eventType: 'user_signin', actorId: null, createdAt: '2024-06-01T10:00:00Z', metadata: {} },
  ],
}

const roleCatalog: RoleCatalogEntry[] = [
  { id: 'r1', key: 'iam.viewer', name: 'IAM Viewer', scope: 'global' },
  { id: 'r2', key: 'iam.admin', name: 'IAM Admin', scope: 'global' },
  { id: 'r3', key: 'cases.read', name: 'Cases Reader', scope: 'global' },
]

const SELF_ID = 'me-admin'

// ── Import after mocks ────────────────────────────────────────────────────────
// eslint-disable-next-line import/first
import { UserDetailClient } from './user-detail-client'

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('UserDetailClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── 1. Status panel renders ────────────────────────────────────────────────

  it('renders lifecycle action buttons for active status', () => {
    render(
      <UserDetailClient detail={baseDetail} roleCatalog={roleCatalog} currentUserId={SELF_ID} />,
    )
    // Active user: Suspend and Soft-delete should be present
    expect(screen.getByRole('button', { name: /actionSuspend/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /actionSoftDelete/i })).toBeInTheDocument()
    // Reset password visible for active
    expect(screen.getByRole('button', { name: /actionResetPassword/i })).toBeInTheDocument()
  })

  it('renders existing role chips', () => {
    render(
      <UserDetailClient detail={baseDetail} roleCatalog={roleCatalog} currentUserId={SELF_ID} />,
    )
    // detail.roles = ['iam.viewer'] which maps to 'IAM Viewer' in catalog
    expect(screen.getByText('IAM Viewer')).toBeInTheDocument()
  })

  // ── 2. Suspend opens confirm dialog; only confirming calls suspendUser ──────

  it('clicking Suspend opens the confirm dialog without calling suspendUser', () => {
    render(
      <UserDetailClient detail={baseDetail} roleCatalog={roleCatalog} currentUserId={SELF_ID} />,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /actionSuspend/i }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(mockSuspendUser).not.toHaveBeenCalled()
  })

  it('cancelling the confirm dialog closes it without calling suspendUser', () => {
    render(
      <UserDetailClient detail={baseDetail} roleCatalog={roleCatalog} currentUserId={SELF_ID} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /actionSuspend/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByText('confirmCancel'))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockSuspendUser).not.toHaveBeenCalled()
  })

  it('confirming the dialog calls suspendUser with the token and id', async () => {
    render(
      <UserDetailClient detail={baseDetail} roleCatalog={roleCatalog} currentUserId={SELF_ID} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /actionSuspend/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(mockSuspendUser).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByText('confirmProceed'))
    })

    await waitFor(() => {
      expect(mockSuspendUser).toHaveBeenCalledWith('test-token', 'u1', undefined)
    })
  })

  it('Escape key dismisses the confirm dialog without calling suspendUser', () => {
    render(
      <UserDetailClient detail={baseDetail} roleCatalog={roleCatalog} currentUserId={SELF_ID} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /actionSuspend/i }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()

    fireEvent.keyDown(dialog, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockSuspendUser).not.toHaveBeenCalled()
  })

  // ── 3. Self-account suspend is disabled ────────────────────────────────────

  it('Suspend button is disabled when detail.id === currentUserId', () => {
    const selfDetail = { ...baseDetail, id: SELF_ID }
    render(
      <UserDetailClient detail={selfDetail} roleCatalog={roleCatalog} currentUserId={SELF_ID} />,
    )
    const suspendBtn = screen.getByRole('button', { name: /actionSuspend/i })
    expect(suspendBtn).toBeDisabled()
  })

  it('Suspend button is enabled for a non-self user', () => {
    render(
      <UserDetailClient detail={baseDetail} roleCatalog={roleCatalog} currentUserId={SELF_ID} />,
    )
    const suspendBtn = screen.getByRole('button', { name: /actionSuspend/i })
    expect(suspendBtn).not.toBeDisabled()
  })

  // ── 4. Adding a role calls grantUserRole ───────────────────────────────────

  it('selecting a role from the add-role select calls grantUserRole', async () => {
    render(
      <UserDetailClient detail={baseDetail} roleCatalog={roleCatalog} currentUserId={SELF_ID} />,
    )
    // addableRoles = iam.admin + cases.read (iam.viewer already held)
    const select = screen.getByRole('combobox', { name: /addRole/i })
    expect(select).toBeInTheDocument()

    await act(async () => {
      fireEvent.change(select, { target: { value: 'iam.admin' } })
    })

    await waitFor(() => {
      expect(mockGrantUserRole).toHaveBeenCalledWith('test-token', 'u1', 'iam.admin')
    })
  })

  // ── 5. Removing a role chip calls revokeUserRole ───────────────────────────

  it('clicking the × on a role chip calls revokeUserRole', async () => {
    render(
      <UserDetailClient detail={baseDetail} roleCatalog={roleCatalog} currentUserId={SELF_ID} />,
    )
    // iam.viewer chip should have a remove button
    const removeBtn = screen.getByRole('button', { name: /remove role iam\.viewer/i })
    expect(removeBtn).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(removeBtn)
    })

    await waitFor(() => {
      expect(mockRevokeUserRole).toHaveBeenCalledWith('test-token', 'u1', 'iam.viewer')
    })
  })

  // ── 6. Suspended user shows Reactivate instead of Suspend ─────────────────

  it('shows Reactivate (not Suspend) for a suspended user', () => {
    const suspendedDetail = { ...baseDetail, status: 'suspended' as const }
    render(
      <UserDetailClient
        detail={suspendedDetail}
        roleCatalog={roleCatalog}
        currentUserId={SELF_ID}
      />,
    )
    expect(screen.getByRole('button', { name: /actionReactivate/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /actionSuspend/i })).not.toBeInTheDocument()
  })

  // ── 7. Deleted user shows only Restore ────────────────────────────────────

  it('shows only Restore for a deleted user (no reset password)', () => {
    const deletedDetail = { ...baseDetail, status: 'deleted' as const }
    render(
      <UserDetailClient
        detail={deletedDetail}
        roleCatalog={roleCatalog}
        currentUserId={SELF_ID}
      />,
    )
    expect(screen.getByRole('button', { name: /actionRestore/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /actionResetPassword/i })).not.toBeInTheDocument()
  })
})
