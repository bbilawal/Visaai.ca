import { PayoutsRepository } from './payouts.repository.impl';
import type { SupabaseService } from '../shared/supabase/supabase.service';

/**
 * PAY-001 — `listSweepableOrders` read both of its tables unbounded.
 *
 * PostgREST truncates an unbounded select at PGRST_DB_MAX_ROWS (1000 on the
 * self-hosted stack) with no error and no flag, and each half fails in its own
 * direction:
 *
 *   orders — the tail is never returned, so those consultants are never paid.
 *   items  — this is the "already swept" EXCLUSION set, so a truncated read
 *            lets already-paid orders back into the sweep. Stripe's per-order
 *            idempotency key covers that for ~24h; past that window a second
 *            transfer is genuinely created.
 *
 * The fakes below enforce the cap, because a fake that returns everything
 * unbounded would pass with the bug present.
 */
const DB_MAX_ROWS = 1000;

function fakeSupabase(opts: {
  orders: Array<Record<string, unknown>>;
  items: Array<{ service_order_id: string }>;
}) {
  const rangesByTable: Record<string, number[][]> = {};
  const from = (table: string) => {
    const all: unknown[] =
      table === 'consultant_service_orders' ? opts.orders : opts.items;
    let ranged = false;
    let lo = 0;
    let hi = DB_MAX_ROWS - 1;
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      range: (f: number, t: number) => {
        ranged = true;
        lo = f;
        hi = t;
        (rangesByTable[table] ??= []).push([f, t]);
        return chain;
      },
      then: (res: (v: any) => unknown) =>
        Promise.resolve({
          // Unbounded reads are silently capped, exactly as PostgREST does it.
          data: ranged ? all.slice(lo, hi + 1) : all.slice(0, DB_MAX_ROWS),
          error: null,
        }).then(res),
    };
    return chain;
  };
  return {
    supabase: { admin: { from } } as unknown as SupabaseService,
    rangesByTable,
  };
}

const order = (i: number) => ({
  id: `o-${String(i).padStart(5, '0')}`,
  consultant_id: `c-${i % 7}`,
  consultant_payout_usd: 10,
  amount_usd: 20,
  currency: 'usd',
  stripe_payment_intent_id: `pi_${i}`,
  consultant_profiles: {
    stripe_connect_account_id: 'acct_1',
    payouts_enabled: true,
  },
});

describe('PayoutsRepository.listSweepableOrders — paging', () => {
  it('returns every payable order past the row cap', async () => {
    const orders = Array.from({ length: 2500 }, (_, i) => order(i));
    const { supabase } = fakeSupabase({ orders, items: [] });

    const out = await new PayoutsRepository(supabase).listSweepableOrders();

    expect(out).toHaveLength(2500);
  });

  /**
   * The dangerous half. A truncated exclusion set lets a paid order back into
   * the sweep.
   */
  it('excludes every already-swept order, past the row cap', async () => {
    const orders = Array.from({ length: 1200 }, (_, i) => order(i));
    const items = orders.map((o) => ({ service_order_id: String(o.id) }));
    const { supabase } = fakeSupabase({ orders, items });

    const out = await new PayoutsRepository(supabase).listSweepableOrders();

    expect(out).toEqual([]);
  });

  it('sweeps only the orders that are genuinely unswept', async () => {
    const orders = Array.from({ length: 1500 }, (_, i) => order(i));
    const items = orders
      .slice(0, 1400)
      .map((o) => ({ service_order_id: String(o.id) }));
    const { supabase } = fakeSupabase({ orders, items });

    const out = await new PayoutsRepository(supabase).listSweepableOrders();

    expect(out).toHaveLength(100);
    expect(out[0].service_order_id).toBe('o-01400');
  });

  it('pages both tables with explicit inclusive ranges', async () => {
    const orders = Array.from({ length: 1100 }, (_, i) => order(i));
    const items = Array.from({ length: 1100 }, (_, i) => ({
      service_order_id: `x-${i}`,
    }));
    const { supabase, rangesByTable } = fakeSupabase({ orders, items });

    await new PayoutsRepository(supabase).listSweepableOrders();

    expect(rangesByTable['consultant_service_orders']).toContainEqual([0, 999]);
    expect(rangesByTable['consultant_service_orders']).toContainEqual([
      1000, 1999,
    ]);
    expect(rangesByTable['consultant_payout_items']).toContainEqual([0, 999]);
  });
});
