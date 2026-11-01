import { AdminService } from './admin.service';
import type { AdminUsersService } from './admin-users.service';

/**
 * The assignment picker listed only app_metadata consultants, while the
 * platform (JwtGuard) also grants the consultant role through RBAC
 * (user_roles). Live 2026-10-20: two RBAC consultants were never offered, so
 * the applicant's own account was the only consultant an admin could pick.
 */
function make(users: { id: string; email: string; app_metadata?: unknown }[], rbac: string[]) {
  const listUsers = jest
    .fn()
    .mockResolvedValueOnce({ data: { users }, error: null })
    .mockResolvedValue({ data: { users: [] }, error: null });
  const chain = {
    select: () => chain,
    eq: () => Promise.resolve({ data: rbac.map((user_id) => ({ user_id })), error: null }),
  };
  const supabase = {
    admin: { auth: { admin: { listUsers } }, from: () => chain },
  } as never;
  return new AdminService(supabase, {} as unknown as AdminUsersService);
}

describe('AdminService.listConsultants', () => {
  it('lists app_metadata consultants and RBAC consultants with no app_metadata role', async () => {
    const svc = make(
      [
        { id: 'a', email: 'meta@x.com', app_metadata: { role: 'consultant' } },
        { id: 'b', email: 'rbac@x.com', app_metadata: {} },
        { id: 'c', email: 'user@x.com', app_metadata: {} },
        // An explicit app_metadata role wins, as in JwtGuard: not a consultant.
        { id: 'd', email: 'demoted@x.com', app_metadata: { role: 'user' } },
      ],
      ['b', 'd'],
    );
    expect((await svc.listConsultants()).map((u) => u.email)).toEqual(['meta@x.com', 'rbac@x.com']);
  });
});
