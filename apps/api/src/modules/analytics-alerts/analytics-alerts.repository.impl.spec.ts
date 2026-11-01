import { SupabaseAnalyticsAlertsRepository } from './analytics-alerts.repository.impl';

function fakeSupabase(row: any) {
  const q: any = {
    insert: () => q,
    select: () => q,
    single: () => Promise.resolve({ data: row, error: null }),
  };
  return { admin: { from: () => q } } as any;
}

describe('SupabaseAnalyticsAlertsRepository', () => {
  it('maps a created rule row', async () => {
    const svc = fakeSupabase({
      id: 'a1',
      name: 'x',
      metric_key: 'financial',
      metric: 'mrr_trend',
      query: {},
      conditions: [],
      combine: 'all',
      recipients: [],
      notify_user_ids: [],
      enabled: true,
      state: 'ok',
      last_value: null,
      last_evaluated_at: null,
      last_transition_at: null,
      created_by: 'u1',
      created_at: 't',
      updated_at: 't',
    });
    const repo = new SupabaseAnalyticsAlertsRepository(svc);
    const r = await repo.createRule({
      name: 'x',
      metricKey: 'financial',
      metric: 'mrr_trend',
      query: {},
      conditions: [],
      combine: 'all',
      recipients: [],
      notifyUserIds: [],
      enabled: true,
      createdBy: 'u1',
    } as any);
    expect(r).toMatchObject({ id: 'a1', metricKey: 'financial', state: 'ok' });
  });
});
