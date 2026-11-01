import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  JwtGuard,
  ALLOW_ANONYMOUS_KEY,
  ALLOW_UNAUTHENTICATED_KEY,
} from '../src/modules/auth/jwt.guard';

/**
 * ANALYTICS-001 regression cover.
 *
 * `/analytics/collect` was decorated @AllowAnonymous and still answered 401 to
 * every beacon. The two decorators mean different things and the gap between
 * them cost the product its entire acquisition funnel:
 *
 *   @AllowAnonymous       — a GUEST SUPABASE IDENTITY may pass. The caller still
 *                           holds a JWT; this only relaxes the is_anonymous gate.
 *   @AllowUnauthenticated — a caller with NO CREDENTIAL AT ALL may pass.
 *
 * `navigator.sendBeacon` cannot set an Authorization header, so the web client's
 * tokenless path could never satisfy the first. Every `session.started` and
 * every page view from a logged-out visitor was rejected and discarded.
 *
 * These tests assert the distinction directly, so re-marking the route with
 * only @AllowAnonymous reintroduces a red test rather than silent data loss.
 */

type GuardContext = {
  switchToHttp: () => { getRequest: () => Record<string, unknown> };
  getHandler: () => unknown;
  getClass: () => unknown;
};

function contextFor(request: Record<string, unknown>): GuardContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => 'handler',
    getClass: () => 'class',
  };
}

/** A Reflector that reports the given decorators as present on the route. */
function reflectorWith(keys: string[]): Reflector {
  return {
    getAllAndOverride: (key: string) => (keys.includes(key) ? true : undefined),
  } as unknown as Reflector;
}

const config = { get: () => [] } as never;

function guardFor(keys: string[], getUser?: jest.Mock): JwtGuard {
  const supabase = {
    admin: { auth: { getUser: getUser ?? jest.fn() } },
    forUser: jest.fn(() => ({ scoped: true })),
  } as never;
  return new JwtGuard(supabase, reflectorWith(keys), config);
}

describe('ANALYTICS-001 — unauthenticated telemetry ingest', () => {
  it('rejects a tokenless request when only @AllowAnonymous is present', async () => {
    // This is the exact prior state of /analytics/collect.
    const guard = guardFor([ALLOW_ANONYMOUS_KEY]);
    const request: Record<string, unknown> = { headers: {} };
    await expect(
      guard.canActivate(contextFor(request) as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('admits a tokenless request when @AllowUnauthenticated is present', async () => {
    const guard = guardFor([ALLOW_ANONYMOUS_KEY, ALLOW_UNAUTHENTICATED_KEY]);
    const request: Record<string, unknown> = { headers: {} };
    await expect(guard.canActivate(contextFor(request) as never)).resolves.toBe(
      true,
    );
    expect(request.user).toBeNull();
  });

  it('degrades an expired or malformed token to unauthenticated, not 401', async () => {
    // A lapsed session must not cost us the event.
    const getUser = jest
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'expired' } });
    const guard = guardFor(
      [ALLOW_ANONYMOUS_KEY, ALLOW_UNAUTHENTICATED_KEY],
      getUser,
    );
    const request: Record<string, unknown> = {
      headers: { authorization: 'Bearer stale' },
    };
    await expect(guard.canActivate(contextFor(request) as never)).resolves.toBe(
      true,
    );
    expect(request.user).toBeNull();
  });

  it('still attributes the event when a valid token IS supplied', async () => {
    const getUser = jest.fn().mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'a@b.test',
          role: 'authenticated',
          app_metadata: { role: 'user' },
        },
      },
      error: null,
    });
    const guard = guardFor(
      [ALLOW_ANONYMOUS_KEY, ALLOW_UNAUTHENTICATED_KEY],
      getUser,
    );
    const request: Record<string, unknown> = {
      headers: { authorization: 'Bearer good' },
    };
    await expect(guard.canActivate(contextFor(request) as never)).resolves.toBe(
      true,
    );
    expect(request.user).toMatchObject({ id: 'user-1', appRole: 'user' });
  });

  it('does NOT relax any route that has not opted in', async () => {
    // The blast radius must stay at the decorated handlers.
    const guard = guardFor([]);
    const request: Record<string, unknown> = { headers: {} };
    await expect(
      guard.canActivate(contextFor(request) as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

/**
 * FLAG-001 — the same decorator confusion, found on a second route.
 *
 * `/feature-flags` carried @AllowAnonymous and a docblock stating that "the beta
 * banner and kill switches have to render correctly before signup". It answered
 * 401 to every logged-out caller, so the kill switches could not be read on
 * precisely the pre-signup surface they exist to protect.
 *
 * Asserted against the real decorator metadata rather than a mock, so removing
 * either decorator fails here.
 */
describe('FLAG-001 — routes that must serve a caller with no credential', () => {
  const reflector = new Reflector();

  it.each([
    [
      'AnalyticsController.collect',
      'analytics/analytics.controller',
      'AnalyticsController',
      'collect',
    ],
    [
      'FeatureFlagsController.list',
      'feature-flags/feature-flags.controller',
      'FeatureFlagsController',
      'list',
    ],
  ])(
    '%s opts in to @AllowUnauthenticated',
    (_label, modulePath, className, method) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(`../src/modules/${modulePath}`);
      const handler = mod[className].prototype[method];
      // jest's expect takes exactly one argument (unlike vitest's).
      expect(handler).toBeDefined();
      expect(
        reflector.getAllAndOverride<boolean>(ALLOW_UNAUTHENTICATED_KEY, [
          handler,
          mod[className],
        ]),
      ).toBe(true);
    },
  );
});
