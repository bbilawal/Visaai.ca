import { PlanReviewPayoutService } from './plan-review-payout.service';

/**
 * Minimal PostgREST-ish fake: `from(table)` returns a chainable whose terminal
 * `maybeSingle()` resolves to whatever the table was seeded with, and `insert()`
 * records the row.
 */
function makeSupabase(seed: Record<string, unknown>) {
  const inserts: Record<string, unknown[]> = {};
  const admin = {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: seed[table] ?? null }),
        insert: (row: unknown) => {
          (inserts[table] ??= []).push(row);
          return Promise.resolve({ error: null });
        },
      };
      return chain;
    },
  };
  return { supabase: { admin } as never, inserts };
}

const commission = {
  splitFor: jest.fn(() =>
    Promise.resolve({
      gross_usd: 250,
      platform_fee_usd: 50,
      consultant_payout_usd: 200,
      rule_id: 'rule_1',
    }),
  ),
} as never;

describe('PlanReviewPayoutService.creditExpertReview', () => {
  beforeEach(() => jest.clearAllMocks());

  it('records a plan-covered order worth the consultant’s share of the plan price', async () => {
    const { supabase, inserts } = makeSupabase({
      applications: { id: 'a1', user_id: 'u_buyer', plan_tier: 'expert' },
      consultant_profiles: { id: 'prof_1' },
      consultant_service_orders: null, // not yet credited
    });
    const svc = new PlanReviewPayoutService(supabase, commission);

    const r = await svc.creditExpertReview('a1', 'user_of_consultant');

    expect(r).toEqual({ recorded: true });
    const row = inserts['consultant_service_orders'][0] as Record<
      string,
      unknown
    >;
    // Credited to the PROFILE id, never the user id — the two id spaces share
    // the column name `consultant_id` and mixing them pays the wrong row.
    expect(row.consultant_id).toBe('prof_1');
    expect(row.user_id).toBe('u_buyer');
    expect(row.status).toBe('paid');
    expect(row.service_type).toBe('premium_review');
    expect(row.consultant_payout_usd).toBe(200);
    // No Stripe charge of its own: the plan purchase already collected.
    expect(row.credit_covered).toBe(true);
    expect(row.paid_at).toBeTruthy();
  });

  it('skips an application that is not on the expert plan', async () => {
    const { supabase, inserts } = makeSupabase({
      applications: { id: 'a1', user_id: 'u', plan_tier: 'copilot' },
    });
    const svc = new PlanReviewPayoutService(supabase, commission);

    expect(await svc.creditExpertReview('a1', 'u_c')).toEqual({
      recorded: false,
      reason: 'not_expert_plan',
    });
    expect(inserts['consultant_service_orders']).toBeUndefined();
  });

  it('skips — and does not throw — when the consultant has no marketplace profile', async () => {
    // Real case: a consultant provisioned via app_metadata with no
    // consultant_profiles row. Their decision must still succeed.
    const { supabase, inserts } = makeSupabase({
      applications: { id: 'a1', user_id: 'u', plan_tier: 'expert' },
      consultant_profiles: null,
    });
    const svc = new PlanReviewPayoutService(supabase, commission);

    expect(await svc.creditExpertReview('a1', 'u_c')).toEqual({
      recorded: false,
      reason: 'no_consultant_profile',
    });
    expect(inserts['consultant_service_orders']).toBeUndefined();
  });

  it('does not credit the same review twice', async () => {
    const { supabase, inserts } = makeSupabase({
      applications: { id: 'a1', user_id: 'u', plan_tier: 'expert' },
      consultant_profiles: { id: 'prof_1' },
      consultant_service_orders: { id: 'existing' },
    });
    const svc = new PlanReviewPayoutService(supabase, commission);

    expect(await svc.creditExpertReview('a1', 'u_c')).toEqual({
      recorded: false,
      reason: 'already_credited',
    });
    expect(inserts['consultant_service_orders']).toBeUndefined();
  });

  it('swallows a failure so a consultant’s decision never fails on crediting', async () => {
    const exploding = {
      admin: {
        from: () => {
          throw new Error('db down');
        },
      },
    } as never;
    const svc = new PlanReviewPayoutService(exploding, commission);

    expect(await svc.creditExpertReview('a1', 'u_c')).toEqual({
      recorded: false,
      reason: 'error',
    });
  });
});
