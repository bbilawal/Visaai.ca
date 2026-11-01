import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  RolesGuard,
  RequireRole,
  type AppRole,
} from '../src/modules/auth/roles.guard';
import type { AuthUser } from '../src/modules/auth/jwt.guard';

function ctx(user: Partial<AuthUser> | undefined): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}
function guard(required: AppRole[] | undefined) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(required),
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}
const U = (appRole?: AuthUser['appRole']): Partial<AuthUser> => ({
  id: 'u1',
  email: 'e',
  role: 'authenticated',
  appRole,
});

describe('RolesGuard (appRole only)', () => {
  it('allows when no @RequireRole is set', () => {
    expect(guard(undefined).canActivate(ctx(U('user')))).toBe(true);
  });
  it('admin passes any required role', () => {
    expect(guard(['consultant']).canActivate(ctx(U('admin')))).toBe(true);
  });
  it('consultant passes when consultant required', () => {
    expect(guard(['consultant']).canActivate(ctx(U('consultant')))).toBe(true);
  });
  it('plain user is denied when consultant required', () => {
    expect(() => guard(['consultant']).canActivate(ctx(U('user')))).toThrow(
      ForbiddenException,
    );
  });
  it('fails closed when appRole is missing (defensive)', () => {
    expect(() => guard(['consultant']).canActivate(ctx(U(undefined)))).toThrow(
      /Missing role claim/,
    );
  });
  it('denies when no user on request', () => {
    expect(() => guard(['consultant']).canActivate(ctx(undefined))).toThrow(
      /not authenticated/,
    );
  });
  it('ignores AuthUser.role entirely (role=consultant string does NOT grant)', () => {
    // role is the Supabase auth role, not RBAC; only appRole counts.
    const sneaky = {
      id: 'u1',
      email: 'e',
      role: 'consultant',
    } as Partial<AuthUser>; // no appRole
    expect(() => guard(['consultant']).canActivate(ctx(sneaky))).toThrow(
      ForbiddenException,
    );
  });

  // ── CLASS-level @RequireRole must be enforced (real Reflector) ─────────────
  // Regression guard for the bypass where getHandler()-only reflection missed
  // class-level metadata and fell open. Admin controllers decorate at the CLASS.
  describe('class-level @RequireRole (real reflector)', () => {
    @RequireRole('admin')
    class AdminOnlyController {
      handler(): void {}
    }
    function realCtx(user: Partial<AuthUser>): ExecutionContext {
      return {
        getHandler: () => AdminOnlyController.prototype.handler,
        getClass: () => AdminOnlyController,
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
      } as unknown as ExecutionContext;
    }
    const g = new RolesGuard(new Reflector());

    it('denies a non-admin against a class-decorated controller', () => {
      expect(() => g.canActivate(realCtx(U('user')))).toThrow(
        ForbiddenException,
      );
    });
    it('allows an admin against a class-decorated controller', () => {
      expect(g.canActivate(realCtx(U('admin')))).toBe(true);
    });
  });
});
