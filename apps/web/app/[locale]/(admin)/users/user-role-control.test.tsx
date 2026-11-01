/**
 * UserRoleControl — the refusal path.
 *
 * `POST /admin/users/:id/role` used to have no last-admin or self-demotion
 * guard (ADMIN-003). Now that it can refuse, the reason is the entire useful
 * content of the response: "cannot remove the last platform admin" tells the
 * admin what to do instead, where a bare "failed" tells them nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { ApiError } from '@/lib/api/client'

const mockSetUserRole = vi.fn()

/**
 * Queue ONE rejection for the next call.
 *
 * Deliberately `mockImplementationOnce`, not a persistent implementation: a
 * mock left standing in a permanently-rejecting state produces a rejection that
 * vitest reports as unhandled at teardown, failing the test even though the
 * component's own catch handled the one call it made. Each test here makes
 * exactly one call, so a single queued rejection is also the honest fixture.
 */
const rejectOnceWith = (e: unknown) =>
  mockSetUserRole.mockImplementationOnce(() => Promise.reject(e))

vi.mock('@/lib/api/admin-client', () => ({
  setUserRole: (...args: unknown[]) => mockSetUserRole(...args),
  getConsultantCountries: vi.fn().mockResolvedValue({ codes: [] }),
  setConsultantCountries: vi.fn().mockResolvedValue({ codes: [] }),
  bulkUsers: vi.fn(),
}))

vi.mock('@/lib/supabase/client', () => ({
  getSession: () =>
    Promise.resolve({ data: { session: { access_token: 't' } } }),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/users',
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

// A real <select> so the role change can actually be driven.
vi.mock('@/components/ui/searchable-select', () => ({
  SearchableSelect: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string
    onChange: (v: string) => void
    ariaLabel?: string
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="admin">admin</option>
      <option value="consultant">consultant</option>
      <option value="user">user</option>
    </select>
  ),
}))

const { UserRoleControl } = await import('./users-client')

const user = {
  id: 'u1',
  email: 'boss@example.com',
  appRole: 'admin' as const,
  status: 'active' as const,
  fullName: null,
  createdAt: '2026-01-01T00:00:00Z',
}

/**
 * Synchronous on purpose. Wrapping these already-synchronous calls in an
 * `async` function inserts a microtask tick between the rejection and the
 * component's `catch`, which vitest's unhandled-rejection detector flags as a
 * test failure even though the component handles it correctly.
 */
/**
 * Drive a role change to completion.
 *
 * The change handler is fire-and-forget (`onChange={(next) => void change(next)}`),
 * so the component's own try/catch settles on a later microtask. Flushing
 * inside `act` lets that catch run before the assertion — and before vitest's
 * unhandled-rejection detector sees a rejection nobody has handled yet.
 */
async function demote(to = 'user') {
  await act(async () => {
    fireEvent.click(screen.getByRole('button'))
  })
  await act(async () => {
    fireEvent.change(screen.getByRole('combobox'), { target: { value: to } })
  })
}

describe('UserRoleControl', () => {
  beforeEach(() => mockSetUserRole.mockReset())

  it("shows the server's reason when the guard refuses", async () => {
    rejectOnceWith(
      new ApiError(
        403,
        'POST /admin/users/u1/role -> 403',
        'cannot remove the last platform admin',
      ),
    )

    render(<UserRoleControl user={user as never} />)
    await demote()

    await waitFor(() =>
      expect(
        screen.getByText('cannot remove the last platform admin'),
      ).toBeTruthy(),
    )
  })

  it('announces the refusal to assistive tech', async () => {
    rejectOnceWith(new ApiError(403, 'x', 'cannot remove your own admin role'))

    render(<UserRoleControl user={user as never} />)
    await demote()

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'cannot remove your own admin role',
      ),
    )
  })

  it('falls back to the generic label when the API sent no reason', async () => {
    rejectOnceWith(new ApiError(500, 'boom'))

    render(<UserRoleControl user={user as never} />)
    await demote()

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('failed'))
  })

  it('reports success without an alert', async () => {
    mockSetUserRole.mockResolvedValue({})

    render(<UserRoleControl user={user as never} />)
    await demote()

    await waitFor(() => expect(screen.getByText('saved')).toBeTruthy())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('clears a stale reason when a later attempt succeeds', async () => {
    rejectOnceWith(new ApiError(403, 'x', 'nope'))
    render(<UserRoleControl user={user as never} />)
    await demote()
    await waitFor(() => expect(screen.getByText('nope')).toBeTruthy())

    mockSetUserRole.mockResolvedValue({})
    await demote('consultant')

    await waitFor(() => expect(screen.getByText('saved')).toBeTruthy())
    expect(screen.queryByText('nope')).toBeNull()
  })
})
