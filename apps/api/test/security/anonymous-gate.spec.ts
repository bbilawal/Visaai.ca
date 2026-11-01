import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { ConfigService } from '@nestjs/config';
import {
  JwtGuard,
  ALLOW_ANONYMOUS_KEY,
} from '../../src/modules/auth/jwt.guard';
import type { SupabaseService } from '../../src/modules/shared/supabase/supabase.service';
import type { Env } from '../../src/config/configuration';

interface FakeUser {
  id: string;
  email?: string;
  role?: string;
  app_metadata?: Record<string, unknown>;
  is_anonymous?: boolean;
}

function makeGuard(opts: {
  user: FakeUser | null;
  error?: { message: string } | null;
  allowAnonymous: boolean;
}): { guard: JwtGuard; req: Record<string, unknown> } {
  const getUser = jest.fn().mockResolvedValue({
    data: { user: opts.user },
    error: opts.error ?? null,
  });

  // resolveAppRole falls back to a consultant-assignment lookup when
  // app_metadata.role is absent (the anonymous case). Stub the chain → no row.
  const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
  const from = jest.fn().mockReturnValue({
    select: () => ({
      eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle }) }) }),
    }),
  });
  const forUser = jest.fn().mockReturnValue({ scoped: true });

  const supabase = {
    admin: { auth: { getUser }, from },
    forUser,
  } as unknown as SupabaseService;

  // Key-aware on purpose. A mock that answers the same value for every metadata
  // key cannot tell @AllowAnonymous from @AllowUnauthenticated, and would report
  // this route as opting into BOTH — which is precisely the distinction the
  // "missing bearer token" case below exists to pin (ANALYTICS-001).
  const reflector = {
    getAllAndOverride: jest.fn((key: string) =>
      key === ALLOW_ANONYMOUS_KEY ? opts.allowAnonymous : undefined,
    ),
  } as unknown as Reflector;

  const config = {
    get: () => [] as string[],
  } as unknown as ConfigService<Env>;

  const req: Record<string, unknown> = {
    headers: { authorization: 'Bearer tok' },
  };
  const guard = new JwtGuard(supabase, reflector, config);
  return { guard, req };
}

function ctx(req: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class Dummy {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('Security — anonymous (guest) gate in JwtGuard', () => {
  it('blocks an anonymous identity on a gated route (no @AllowAnonymous) with 403', async () => {
    const { guard, req } = makeGuard({
      user: { id: 'g1', email: '', is_anonymous: true, app_metadata: {} },
      allowAnonymous: false,
    });
    await expect(guard.canActivate(ctx(req))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('403 is NOT downgraded to 401 by the catch-all', async () => {
    const { guard, req } = makeGuard({
      user: { id: 'g1', email: '', is_anonymous: true, app_metadata: {} },
      allowAnonymous: false,
    });
    await expect(guard.canActivate(ctx(req))).rejects.not.toThrow(
      UnauthorizedException,
    );
  });

  it('allows an anonymous identity on an @AllowAnonymous route and sets isAnonymous=true', async () => {
    const { guard, req } = makeGuard({
      user: { id: 'g1', email: '', is_anonymous: true, app_metadata: {} },
      allowAnonymous: true,
    });
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect((req.user as { isAnonymous: boolean }).isAnonymous).toBe(true);
  });

  it('allows a permanent (non-anonymous) identity on a gated route, isAnonymous=false', async () => {
    const { guard, req } = makeGuard({
      user: {
        id: 'u1',
        email: 'real@x.com',
        is_anonymous: false,
        app_metadata: { role: 'user' },
      },
      allowAnonymous: false,
    });
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect((req.user as { isAnonymous: boolean }).isAnonymous).toBe(false);
  });

  it('treats a missing is_anonymous flag as a permanent user (not a guest)', async () => {
    const { guard, req } = makeGuard({
      user: { id: 'u2', email: 'real@x.com', app_metadata: { role: 'user' } },
      allowAnonymous: false,
    });
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect((req.user as { isAnonymous: boolean }).isAnonymous).toBe(false);
  });

  it('rejects a missing bearer token with 401 (unchanged behavior)', async () => {
    const { guard } = makeGuard({ user: null, allowAnonymous: true });
    const req: Record<string, unknown> = { headers: {} };
    await expect(guard.canActivate(ctx(req))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
