import { ServiceUnavailableException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { FeatureFlagGuard } from './feature-flag.guard';
import type { FeatureFlagsService } from './feature-flags.service';

function makeContext(user?: {
  id: string;
  appRole?: string;
}): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function makeReflector(key: string | undefined): Reflector {
  return { getAllAndOverride: () => key } as unknown as Reflector;
}

function makeFlags(enabled: boolean) {
  const subjectFor = jest.fn(async (u: { id: string; appRole?: string }) => ({
    userId: u.id,
    appRole: u.appRole,
    cohorts: ['internal'],
  }));
  const isEnabled = jest.fn(async () => enabled);
  return {
    service: { subjectFor, isEnabled } as unknown as FeatureFlagsService,
    subjectFor,
    isEnabled,
  };
}

describe('FeatureFlagGuard', () => {
  it('allows a route with no @RequireFlag', async () => {
    const { service, isEnabled } = makeFlags(false);
    const guard = new FeatureFlagGuard(makeReflector(undefined), service);

    await expect(guard.canActivate(makeContext({ id: 'u1' }))).resolves.toBe(
      true,
    );
    // Nothing to enforce → no evaluation at all.
    expect(isEnabled).not.toHaveBeenCalled();
  });

  it('allows the request when the flag is on', async () => {
    const { service } = makeFlags(true);
    const guard = new FeatureFlagGuard(
      makeReflector('payments_enabled'),
      service,
    );

    await expect(guard.canActivate(makeContext({ id: 'u1' }))).resolves.toBe(
      true,
    );
  });

  it('refuses with 503 + feature_disabled when the flag is off', async () => {
    const { service } = makeFlags(false);
    const guard = new FeatureFlagGuard(
      makeReflector('payments_enabled'),
      service,
    );

    // 503 rather than 404: the route exists and the request was well-formed —
    // the capability is administratively unavailable and may come back.
    await expect(
      guard.canActivate(makeContext({ id: 'u1' })),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    try {
      await guard.canActivate(makeContext({ id: 'u1' }));
      throw new Error('expected a rejection');
    } catch (e) {
      expect((e as ServiceUnavailableException).getResponse()).toMatchObject({
        statusCode: 503,
        code: 'feature_disabled',
        flag: 'payments_enabled',
      });
    }
  });

  it('resolves cohort targeting from the authenticated user', async () => {
    const { service, subjectFor, isEnabled } = makeFlags(true);
    const guard = new FeatureFlagGuard(
      makeReflector('payments_enabled'),
      service,
    );

    await guard.canActivate(makeContext({ id: 'u1', appRole: 'consultant' }));

    expect(subjectFor).toHaveBeenCalledWith({
      id: 'u1',
      appRole: 'consultant',
    });
    expect(isEnabled).toHaveBeenCalledWith(
      'payments_enabled',
      expect.objectContaining({ userId: 'u1', cohorts: ['internal'] }),
    );
  });

  it('evaluates with an empty subject when the route is unauthenticated', async () => {
    const { service, subjectFor, isEnabled } = makeFlags(true);
    const guard = new FeatureFlagGuard(
      makeReflector('beta_banner_enabled'),
      service,
    );

    await guard.canActivate(makeContext(undefined));

    expect(subjectFor).not.toHaveBeenCalled();
    expect(isEnabled).toHaveBeenCalledWith('beta_banner_enabled', {});
  });
});
