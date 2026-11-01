import { SupabaseKpiSourceRepository } from './kpi-source.repository.impl';

function fakeSupabase(rows: any[]) {
  const q: any = {
    select: () => q,
    eq: () => q,
    gte: () => q,
    lte: () => q,
    order: () => Promise.resolve({ data: rows, error: null }),
  };
  return { admin: { from: () => q } } as any;
}

describe('SupabaseKpiSourceRepository', () => {
  it('maps kpi_metric_daily rows to DailyValueRow', async () => {
    const svc = fakeSupabase([
      { day: '2026-07-01', dim_val: '', value_num: 1000 },
    ]);
    const repo = new SupabaseKpiSourceRepository(svc);
    const out = await repo.queryMetricDaily(
      'mrr',
      '2026-07-01',
      '2026-07-31',
      '',
    );
    expect(out).toEqual([{ day: '2026-07-01', dimVal: '', value: 1000 }]);
  });

  it('maps ai_cost_per_application matview rows', async () => {
    const svc = fakeSupabase([{ day: '2026-07-01', cost_cents: 250 }]);
    const repo = new SupabaseKpiSourceRepository(svc);
    const out = await repo.queryAiCostPerApplication(
      '2026-07-01',
      '2026-07-31',
    );
    expect(out).toEqual([{ day: '2026-07-01', costCents: 250 }]);
  });
});
