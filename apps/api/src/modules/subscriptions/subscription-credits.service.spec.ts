import { SubscriptionCreditsService } from './subscription-credits.service';

describe('SubscriptionCreditsService', () => {
  it('grantForPeriod upserts a period row with the plan cap, idempotent on (sub, period_start)', async () => {
    const upsert = jest.fn().mockResolvedValue({ error: null });
    const supabase: any = {
      admin: { from: jest.fn().mockReturnValue({ upsert }) },
    };
    const svc = new SubscriptionCreditsService(supabase);
    await svc.grantForPeriod({
      subscriptionId: 's1',
      userId: 'u1',
      plan: 'pro',
      periodStart: new Date('2026-07-01T00:00:00Z'),
      periodEnd: new Date('2026-08-01T00:00:00Z'),
    });
    const [row, opts] = upsert.mock.calls[0];
    expect(row.granted).toBe(1); // pro cap
    expect(row.consumed).toBe(0);
    expect(opts).toEqual({
      onConflict: 'subscription_id,period_start',
      ignoreDuplicates: true,
    });
  });

  it('base plan grants 0 credits', async () => {
    const upsert = jest.fn().mockResolvedValue({ error: null });
    const supabase: any = {
      admin: { from: jest.fn().mockReturnValue({ upsert }) },
    };
    await new SubscriptionCreditsService(supabase).grantForPeriod({
      subscriptionId: 's1',
      userId: 'u1',
      plan: 'base',
      periodStart: new Date(),
      periodEnd: new Date(),
    });
    expect(upsert.mock.calls[0][0].granted).toBe(0);
  });

  it('tryConsume returns the RPC boolean', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: true, error: null });
    const supabase: any = { admin: { rpc } };
    const ok = await new SubscriptionCreditsService(supabase).tryConsume(
      'u1',
      'a1',
    );
    expect(ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith('consume_review_credit', {
      p_user_id: 'u1',
      p_application_id: 'a1',
    });
  });

  it('tryConsume returns false when RPC errors (fail closed)', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'x' } });
    const supabase: any = { admin: { rpc } };
    expect(
      await new SubscriptionCreditsService(supabase).tryConsume('u1', null),
    ).toBe(false);
  });
});
