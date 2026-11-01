import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../src/modules/auth/roles.guard';
import { OwnerOrAdminGuard } from '../../src/modules/auth/owner-or-admin.guard';
import type { SupabaseService } from '../../src/modules/shared/supabase/supabase.service';
import type { AuthUser } from '../../src/modules/auth/jwt.guard';

function ctx(
  user: Partial<AuthUser> | undefined,
  applicationId?: string,
): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    // RolesGuard reads @RequireRole from BOTH handler and class via
    // getAllAndOverride, so the mock context must expose getClass.
    getClass: () => class Dummy {},
    switchToHttp: () => ({
      getRequest: () => ({ user, params: { applicationId } }),
    }),
  } as unknown as ExecutionContext;
}
const rolesGuard = (required: string[]) =>
  new RolesGuard({
    getAllAndOverride: () => required,
  } as unknown as Reflector);
function ownerGuard(ownerId: string | null) {
  const maybeSingle = jest.fn().mockResolvedValue({
    data: ownerId ? { user_id: ownerId } : null,
    error: null,
  });
  const sb = {
    admin: {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
    },
  } as unknown as SupabaseService;
  return new OwnerOrAdminGuard(sb);
}

describe('Security — RBAC abuse cases', () => {
  it('role confusion: a forged Supabase auth role does NOT grant access (appRole only)', () => {
    // attacker sets role:'admin' but appRole is the real (server-resolved) claim.
    const forged = { id: 'x', email: 'e', role: 'admin' } as Partial<AuthUser>; // no appRole
    expect(() => rolesGuard(['admin']).canActivate(ctx(forged))).toThrow(
      ForbiddenException,
    );
  });

  it('missing appRole fails closed', () => {
    expect(() =>
      rolesGuard(['consultant']).canActivate(
        ctx({ id: 'x', email: 'e', role: 'authenticated' }),
      ),
    ).toThrow(/Missing role claim/);
  });

  it('plain user cannot reach a consultant route', () => {
    expect(() =>
      rolesGuard(['consultant']).canActivate(
        ctx({ id: 'x', email: 'e', role: 'authenticated', appRole: 'user' }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('assignment hijack: non-owner non-admin cannot assign', async () => {
    const g = ownerGuard('real-owner');
    await expect(
      g.canActivate(
        ctx(
          {
            id: 'attacker',
            email: 'e',
            role: 'authenticated',
            appRole: 'user',
          },
          'app-1',
        ),
      ),
    ).rejects.toThrow(/owner or an admin/);
  });

  it('owner can assign on their own application', async () => {
    const g = ownerGuard('owner-1');
    await expect(
      g.canActivate(
        ctx(
          { id: 'owner-1', email: 'e', role: 'authenticated', appRole: 'user' },
          'app-1',
        ),
      ),
    ).resolves.toBe(true);
  });

  it('admin override passes assignment guard without owning the app', async () => {
    const g = ownerGuard('someone-else');
    await expect(
      g.canActivate(
        ctx(
          {
            id: 'admin-1',
            email: 'e',
            role: 'authenticated',
            appRole: 'admin',
          },
          'app-1',
        ),
      ),
    ).resolves.toBe(true);
  });
});
