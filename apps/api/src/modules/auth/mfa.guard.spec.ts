import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { MfaGuard } from './mfa.guard';
import type { AuthUser } from './jwt.guard';

function ctx(user: Partial<AuthUser> | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function guardWith(required: boolean, enforce = true): MfaGuard {
  const reflector = {
    getAllAndOverride: () => required,
  } as unknown as Reflector;
  const config = {
    get: () => enforce,
  } as unknown as import('@nestjs/config').ConfigService;
  return new MfaGuard(reflector, config);
}

const USER = (aal: string | null): Partial<AuthUser> => ({ id: 'u1', aal });

describe('MfaGuard', () => {
  it('passes when @RequireMfa is not set', () => {
    expect(guardWith(false).canActivate(ctx(USER('aal1')))).toBe(true);
  });

  it('passes an aal2 session', () => {
    expect(guardWith(true).canActivate(ctx(USER('aal2')))).toBe(true);
  });

  it('rejects an aal1 session with a mfa_required code', () => {
    try {
      guardWith(true).canActivate(ctx(USER('aal1')));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
      expect((e as ForbiddenException).getResponse()).toMatchObject({
        code: 'mfa_required',
      });
    }
  });

  it('rejects an unauthenticated request', () => {
    expect(() => guardWith(true).canActivate(ctx(undefined))).toThrow(
      ForbiddenException,
    );
  });

  // SEC-1004: enforcement is opt-in; with the flag off @RequireMfa is inert so
  // an admin without an enrolled factor is NOT locked out.
  it('is inert when MFA_ENFORCE_ADMIN is off, even for an aal1 admin', () => {
    expect(guardWith(true, false).canActivate(ctx(USER('aal1')))).toBe(true);
  });
});
