import type { ExecutionContext } from '@nestjs/common';
import { OwnerOrAdminGuard } from '../src/modules/auth/owner-or-admin.guard';
import type { SupabaseService } from '../src/modules/shared/supabase/supabase.service';
import type { AuthUser } from '../src/modules/auth/jwt.guard';

/** Supabase mock whose applications lookup resolves to {data,error}. */
function supabaseReturning(result: {
  data: { user_id: string } | null;
  error: unknown;
}) {
  const maybeSingle = jest.fn().mockResolvedValue(result);
  const eq = jest.fn(() => ({ maybeSingle }));
  const select = jest.fn(() => ({ eq }));
  const from = jest.fn(() => ({ select }));
  return { admin: { from }, _from: from } as unknown as SupabaseService & {
    _from: jest.Mock;
  };
}
function ctx(
  user: Partial<AuthUser> | undefined,
  applicationId?: string,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user, params: { applicationId } }),
    }),
  } as unknown as ExecutionContext;
}
const U = (
  appRole?: AuthUser['appRole'],
  id = 'owner-1',
): Partial<AuthUser> => ({ id, email: 'e', role: 'authenticated', appRole });

describe('OwnerOrAdminGuard', () => {
  it('admin passes without any DB lookup', async () => {
    const sb = supabaseReturning({ data: null, error: null });
    const g = new OwnerOrAdminGuard(sb);
    await expect(g.canActivate(ctx(U('admin'), 'app-1'))).resolves.toBe(true);
    expect(sb._from).not.toHaveBeenCalled();
  });
  it('owner passes (applications.user_id === user.id)', async () => {
    const g = new OwnerOrAdminGuard(
      supabaseReturning({ data: { user_id: 'owner-1' }, error: null }),
    );
    await expect(
      g.canActivate(ctx(U('user', 'owner-1'), 'app-1')),
    ).resolves.toBe(true);
  });
  it('non-owner non-admin is denied', async () => {
    const g = new OwnerOrAdminGuard(
      supabaseReturning({ data: { user_id: 'someone-else' }, error: null }),
    );
    await expect(
      g.canActivate(ctx(U('user', 'attacker'), 'app-1')),
    ).rejects.toThrow(/owner or an admin/);
  });
  it('application not found → denied', async () => {
    const g = new OwnerOrAdminGuard(
      supabaseReturning({ data: null, error: null }),
    );
    await expect(g.canActivate(ctx(U('user', 'x'), 'app-1'))).rejects.toThrow(
      /not found or access denied/,
    );
  });
  it('missing applicationId → denied', async () => {
    const g = new OwnerOrAdminGuard(
      supabaseReturning({ data: null, error: null }),
    );
    await expect(g.canActivate(ctx(U('user', 'x'), undefined))).rejects.toThrow(
      /Application ID required/,
    );
  });
  it('no user → denied', async () => {
    const g = new OwnerOrAdminGuard(
      supabaseReturning({ data: null, error: null }),
    );
    await expect(g.canActivate(ctx(undefined, 'app-1'))).rejects.toThrow(
      /not authenticated/,
    );
  });
});
