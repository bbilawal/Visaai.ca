import { EntitlementService } from './entitlement.service';
import { ConfigService } from '@nestjs/config';

function makeSupabase(activeSub: any | null) {
  const admin = {
    from: jest.fn().mockReturnValue({
      select: () => ({
        eq: () => ({
          in: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: () => Promise.resolve({ data: activeSub }),
              }),
            }),
          }),
        }),
      }),
    }),
  };
  return { admin } as any;
}

const enabled = new ConfigService({ SUBSCRIPTIONS_ENABLED: true });
const disabled = new ConfigService({ SUBSCRIPTIONS_ENABLED: false });

describe('EntitlementService', () => {
  it('flag off: rank = app plan only', async () => {
    const svc = new EntitlementService(
      makeSupabase({ plan: 'base', status: 'active' }),
      disabled,
    );
    expect(await svc.effectiveRank('u1', 'self_service')).toBe(1);
  });

  it('active sub floors rank at copilot(2) above self_service', async () => {
    const svc = new EntitlementService(
      makeSupabase({ plan: 'base', status: 'active' }),
      enabled,
    );
    expect(await svc.effectiveRank('u1', 'self_service')).toBe(2);
  });

  it('app expert(3) beats the subscription floor', async () => {
    const svc = new EntitlementService(
      makeSupabase({ plan: 'premium', status: 'active' }),
      enabled,
    );
    expect(await svc.effectiveRank('u1', 'expert')).toBe(3);
  });

  it('no active sub: rank = app plan', async () => {
    const svc = new EntitlementService(makeSupabase(null), enabled);
    expect(await svc.effectiveRank('u1', 'none')).toBe(0);
  });

  it('subscription never grants expert: premium sub + none app = copilot(2), not 3', async () => {
    const svc = new EntitlementService(
      makeSupabase({ plan: 'premium', status: 'trialing' }),
      enabled,
    );
    expect(await svc.effectiveRank('u1', 'none')).toBe(2);
  });
});

describe('EntitlementService — FREE_ACCESS_USER_IDS', () => {
  const listed = 'f1af2059-eb79-4baf-bb52-cc04df3d2e20';
  const other = '0d8ebe8e-ba57-47b9-a536-31b65652afe9';

  const withList = (ids: string) =>
    new EntitlementService(
      makeSupabase(null),
      new ConfigService({
        SUBSCRIPTIONS_ENABLED: false,
        FREE_ACCESS_USER_IDS: ids,
      }),
    );

  it('grants expert(3) to a listed user, with no subscription and a `none` app', async () => {
    const svc = withList(`${listed},${other}`);
    expect(await svc.effectiveRank(listed, 'none')).toBe(3);
  });

  it('changes nothing for a user who is not listed', async () => {
    const svc = withList(listed);
    expect(await svc.effectiveRank('someone-else', 'none')).toBe(0);
    expect(await svc.effectiveRank('someone-else', 'self_service')).toBe(1);
  });

  it('is inert when the variable is empty — the normal production state', async () => {
    const svc = withList('');
    expect(await svc.effectiveRank(listed, 'none')).toBe(0);
    expect(svc.hasFreeAccess(listed)).toBe(false);
  });

  it('tolerates spaces and trailing commas rather than silently granting nothing', () => {
    // A list pasted from a note or an .env line ends up like this, and the
    // failure mode of getting it wrong is a tester blocked at a paywall with
    // no visible reason.
    const svc = withList(`  ${listed} , ${other} , `);
    expect(svc.hasFreeAccess(listed)).toBe(true);
    expect(svc.hasFreeAccess(other)).toBe(true);
    expect(svc.hasFreeAccess('')).toBe(false);
  });
});
