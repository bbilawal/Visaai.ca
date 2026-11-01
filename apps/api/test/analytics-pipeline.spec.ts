import { SupabaseKpiRollupReader } from '../src/modules/analytics-metrics/rollup/supabase-kpi-rollup.reader';
import { KpiRollupService } from '../src/modules/analytics-metrics/rollup/kpi-rollup.service';
import { RetentionMetricsService } from '../src/modules/analytics-metrics/services/retention-metrics.service';
import { MockKpiSourceRepository } from '../src/modules/analytics-metrics/source/mock-kpi-source.repository';

/**
 * PostgREST caps an unbounded select at PGRST_DB_MAX_ROWS (1000 self-hosted)
 * silently, so the reader pages with explicit ranges. The fake models both:
 * `.range()` slices, and an unranged read is truncated the way the server
 * would truncate it.
 */
const DB_MAX_ROWS = 1000;

function fakeSupabase(byTable: Record<string, any[]>) {
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

describe('analytics full pipeline golden', () => {
  it('a sub that cancels AND fails-payment counts once (voluntary) end-to-end', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const reader = new SupabaseKpiRollupReader(
      fakeSupabase({
        analytics_event_stream: [
          {
            name: 'subscription.canceled',
            occurred_at: `${today}T00:00:00Z`,
            props: { subscription_id: 'sub_1' },
          },
        ],
        payment_dunning: [
          {
            subscription_id: 'sub_1',
            status: 'canceled',
            updated_at: `${today}T00:00:00Z`,
          },
        ],
        subscriptions: [
          { status: 'active', plan: 'pro', billing_interval: 'month' },
        ],
        consultant_service_orders: [],
      }),
    );
    const metricRows: any[] = [];
    const writer = {
      upsertMetricDaily: async (rows: any[]) => void metricRows.push(...rows),
      upsertFunnelDaily: async () => {},
      upsertIdentityLinks: async () => {},
    } as any;
    const rollup = new KpiRollupService(reader, writer);
    await rollup.recompute(7);

    const churn = metricRows.filter((r) => r.metric === 'churn_total');
    expect(churn).toHaveLength(1); // deduped: voluntary wins over the involuntary dunning cancel

    const src = new MockKpiSourceRepository({
      metricDaily: churn.map((r) => ({
        metric: r.metric,
        day: r.day,
        dimKey: r.dimKey,
        dimVal: r.dimVal,
        value: r.value,
      })),
    });
    const svc = new RetentionMetricsService(src);
    const out = await svc.churn({ from: today, to: today, grain: 'day' });
    expect(out.total).toBe(1);
  });
});
