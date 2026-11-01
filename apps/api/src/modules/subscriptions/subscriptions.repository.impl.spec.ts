import { SubscriptionsRepository } from './subscriptions.repository.impl';

function makeSupabase(over: any) {
  return { admin: { from: jest.fn((t: string) => over[t]) } } as any;
}

describe('SubscriptionsRepository', () => {
  it('getByStripeId returns the row', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({
      data: { id: 's1', stripe_subscription_id: 'sub_1' },
    });
    const repo = new SubscriptionsRepository(
      makeSupabase({
        subscriptions: { select: () => ({ eq: () => ({ maybeSingle }) }) },
      }),
    );
    const row = await repo.getByStripeId('sub_1');
    expect(row?.id).toBe('s1');
  });

  it('upsertFromStripe upserts on stripe_subscription_id', async () => {
    const upsert = jest.fn().mockResolvedValue({ error: null });
    const repo = new SubscriptionsRepository(
      makeSupabase({ subscriptions: { upsert } }),
    );
    await repo.upsertFromStripe({
      userId: 'u1',
      stripeSubscriptionId: 'sub_1',
      stripeCustomerId: 'cus_1',
      plan: 'pro',
      status: 'active',
      billingInterval: 'month',
      currentPeriodStart: new Date('2026-07-01T00:00:00Z'),
      currentPeriodEnd: new Date('2026-08-01T00:00:00Z'),
      cancelAtPeriodEnd: false,
    });
    const [row, opts] = upsert.mock.calls[0];
    expect(row.stripe_subscription_id).toBe('sub_1');
    expect(row.plan).toBe('pro');
    expect(opts).toEqual({ onConflict: 'stripe_subscription_id' });
  });
});
