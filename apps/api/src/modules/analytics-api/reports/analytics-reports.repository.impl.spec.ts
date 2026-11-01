import { SupabaseAnalyticsReportsRepository } from './analytics-reports.repository.impl';

function fakeSupabase(row: any) {
  const q: any = {
    insert: () => q,
    select: () => q,
    single: () => Promise.resolve({ data: row, error: null }),
  };
  return { admin: { from: () => q } } as any;
}

describe('SupabaseAnalyticsReportsRepository', () => {
  it('maps a created saved report row', async () => {
    const svc = fakeSupabase({
      id: 'r1',
      name: 'MRR',
      metric_key: 'financial',
      metric: 'mrr',
      query: {},
      created_by: 'u1',
      created_at: 't',
      updated_at: 't',
    });
    const repo = new SupabaseAnalyticsReportsRepository(svc);
    const r = await repo.createSaved({
      name: 'MRR',
      metricKey: 'financial',
      metric: 'mrr',
      query: {},
      createdBy: 'u1',
    });
    expect(r).toMatchObject({
      id: 'r1',
      metricKey: 'financial',
      createdBy: 'u1',
    });
  });
});
