import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlanGuard } from './plan.guard';

function ctx(user: any, applicationId = 'a1') {
  return {
    getHandler: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user, params: { applicationId }, body: {} }),
    }),
  } as any;
}

function makeReflector(plan: string | undefined): Reflector {
  return { get: () => plan } as any;
}

function makeSupabase(appPlanTier: string) {
  return {
    admin: {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: () => ({
                data: { plan_tier: appPlanTier, user_id: 'u1' },
              }),
            }),
          }),
        }),
      }),
    },
  } as any;
}

describe('PlanGuard with EntitlementService', () => {
  it('no @RequirePlan → open', async () => {
    const guard = new PlanGuard(
      makeReflector(undefined),
      makeSupabase('none'),
      { effectiveRank: jest.fn() } as any,
    );
    expect(await guard.canActivate(ctx({ id: 'u1' }))).toBe(true);
  });

  it('denies when effective rank below required (no sub)', async () => {
    const entitlement = {
      effectiveRank: jest.fn().mockResolvedValue(1),
    } as any;
    const guard = new PlanGuard(
      makeReflector('copilot'),
      makeSupabase('self_service'),
      entitlement,
    );
    await expect(guard.canActivate(ctx({ id: 'u1' }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('grants when subscription floor lifts effective rank to required', async () => {
    const entitlement = {
      effectiveRank: jest.fn().mockResolvedValue(2),
    } as any;
    const guard = new PlanGuard(
      makeReflector('copilot'),
      makeSupabase('self_service'),
      entitlement,
    );
    expect(await guard.canActivate(ctx({ id: 'u1' }))).toBe(true);
  });
});
