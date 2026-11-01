import { SupabaseKpiRollupReader } from './supabase-kpi-rollup.reader';

/**
 * PostgREST caps an unbounded select at PGRST_DB_MAX_ROWS (1000 on the
 * self-hosted stack) SILENTLY. The fake enforces it, because a fake that
 * returns everything would let the truncation bug pass the tests written to
 * catch it — every method in this reader aggregates its rows in JavaScript.
 */
const DB_MAX_ROWS = 1000;

function fakeSupabase(byTable: Record<string, any[]>, ranges?: number[][]) {
  const make = (rows: any[]) => {
    const q: any = {};
    let ranged = false;
    let lo = 0;
    let hi = DB_MAX_ROWS - 1;
    for (const m of ['select', 'eq', 'gte', 'lte', 'in', 'order', 'not'])
      q[m] = () => q;
    q.range = (f: number, t: number) => {
      ranged = true;
      lo = f;
      hi = t;
      ranges?.push([f, t]);
      return q;
    };
    q.then = (res: any) =>
      Promise.resolve({
        data: ranged ? rows.slice(lo, hi + 1) : rows.slice(0, DB_MAX_ROWS),
        error: null,
      }).then(res);
    return q;
  };
  return { admin: { from: (t: string) => make(byTable[t] ?? []) } } as any;
}

describe('SupabaseKpiRollupReader', () => {
  it('identifiedSince maps user.identified events to anon->user links', async () => {
    const svc = fakeSupabase({
      analytics_event_stream: [
        {
          name: 'user.identified',
          occurred_at: '2026-07-01T00:00:00Z',
          user_id: 'u1',
          anonymous_id: 'a1',
          props: {},
        },
      ],
    });
    expect(await new SupabaseKpiRollupReader(svc).identifiedSince(3)).toEqual([
      { anonymousId: 'a1', userId: 'u1' },
    ]);
  });

  it('churnEventsSince: subscription.canceled -> voluntary, dunning canceled -> involuntary', async () => {
    const svc = fakeSupabase({
      analytics_event_stream: [
        {
          name: 'subscription.canceled',
          occurred_at: '2026-07-05T00:00:00Z',
          props: { subscription_id: 'sub_1' },
        },
      ],
      payment_dunning: [
        {
          subscription_id: 'sub_2',
          status: 'canceled',
          updated_at: '2026-07-06T00:00:00Z',
        },
      ],
    });
    const out = await new SupabaseKpiRollupReader(svc).churnEventsSince(7);
    expect(out).toEqual([
      { subscriptionId: 'sub_1', day: '2026-07-05', kind: 'voluntary' },
      { subscriptionId: 'sub_2', day: '2026-07-06', kind: 'involuntary' },
    ]);
  });

  it('mrrSnapshot sums monthly-equiv cents of active subs', async () => {
    const svc = fakeSupabase({
      subscriptions: [
        { plan: 'pro', status: 'active', billing_interval: 'month' },
        { plan: 'base', status: 'active', billing_interval: 'month' },
      ],
    });
    const rows = await new SupabaseKpiRollupReader(svc).mrrSnapshot(1);
    expect(rows[0].value).toBe(4900 + 1500);
    expect(rows[0].dimVal).toBe('');
  });

  it('commissionSplitsSince reads persisted gross + payout from paid service orders', async () => {
    const svc = fakeSupabase({
      consultant_service_orders: [
        {
          consultant_id: 'c1',
          amount_usd: 100,
          consultant_payout_usd: 80,
          status: 'paid',
          paid_at: '2026-07-10T00:00:00Z',
          created_at: '2026-07-10T00:00:00Z',
        },
      ],
    });
    const out = await new SupabaseKpiRollupReader(svc).commissionSplitsSince(7);
    expect(out).toEqual([
      {
        day: '2026-07-10',
        consultantId: 'c1',
        grossCents: 10000,
        payoutCents: 8000,
      },
    ]);
  });
});

/**
 * KPI-001. Every read in this reader was unbounded and then summed, counted or
 * grouped in JavaScript, so each figure was correct only until its table
 * crossed a thousand rows and quietly wrong — always downward — after that.
 * These are the numbers the business steers by.
 */
describe('SupabaseKpiRollupReader — figures past the row cap', () => {
  const sub = (i: number) => ({
    id: `s-${String(i).padStart(5, '0')}`,
    plan: 'base',
    status: 'active',
    billing_interval: 'month',
    created_at: '2026-05-02T00:00:00Z',
  });

  it('sums MRR over every active subscription, not the first 1000', async () => {
    const subs = Array.from({ length: 2500 }, (_, i) => sub(i));
    const one = (
      await new SupabaseKpiRollupReader(
        fakeSupabase({ subscriptions: [sub(0)] }),
      ).mrrSnapshot(30)
    )[0].value;

    const out = await new SupabaseKpiRollupReader(
      fakeSupabase({ subscriptions: subs }),
    ).mrrSnapshot(30);

    expect(out[0].value).toBe(one * 2500);
  });

  it('counts every active subscriber, not the first 1000', async () => {
    const subs = Array.from({ length: 1750 }, (_, i) => sub(i));
    const out = await new SupabaseKpiRollupReader(
      fakeSupabase({ subscriptions: subs }),
    ).activeAtStart(30);
    expect(out[0].value).toBe(1750);
  });

  it('sizes a cohort from every subscription in it', async () => {
    const subs = Array.from({ length: 1200 }, (_, i) => sub(i));
    const out = await new SupabaseKpiRollupReader(
      fakeSupabase({ subscriptions: subs }),
    ).subscriptionCohorts();
    expect(out).toHaveLength(1);
    expect(out[0].cohortSize).toBe(1200);
    expect(out[0].retained).toBe(1200);
  });

  it('reads every paid service order for the take rate', async () => {
    const orders = Array.from({ length: 1400 }, (_, i) => ({
      id: `o-${String(i).padStart(5, '0')}`,
      consultant_id: 'c1',
      amount_usd: 100,
      consultant_payout_usd: 70,
      status: 'paid',
      paid_at: '2026-07-01T00:00:00Z',
      created_at: '2026-07-01T00:00:00Z',
    }));
    const out = await new SupabaseKpiRollupReader(
      fakeSupabase({ consultant_service_orders: orders }),
    ).commissionSplitsSince(30);
    expect(out).toHaveLength(1400);
  });

  it('reads every event for the funnel', async () => {
    const events = Array.from({ length: 2100 }, (_, i) => ({
      event_id: `e-${String(i).padStart(5, '0')}`,
      name: 'user.identified',
      occurred_at: '2026-07-01T00:00:00Z',
      user_id: `u${i}`,
      anonymous_id: `a${i}`,
      props: {},
    }));
    const out = await new SupabaseKpiRollupReader(
      fakeSupabase({ analytics_event_stream: events }),
    ).identifiedSince(30);
    expect(out).toHaveLength(2100);
  });

  it('pages with explicit inclusive ranges', async () => {
    const ranges: number[][] = [];
    const subs = Array.from({ length: 1100 }, (_, i) => sub(i));
    await new SupabaseKpiRollupReader(
      fakeSupabase({ subscriptions: subs }, ranges),
    ).mrrSnapshot(30);
    expect(ranges).toContainEqual([0, 999]);
    expect(ranges).toContainEqual([1000, 1999]);
  });
});
