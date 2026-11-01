import { AnalyticsRollupService } from './analytics-rollup.service';
import { MockWarehouseProvider } from '../warehouse/mock-warehouse.provider';
import { makeServerEvent } from '../events/catalog';

function fakeSupabase() {
  const upserts: any[] = [];
  const admin = {
    from: (table: string) => ({
      upsert: (rows: any[]) => {
        upserts.push({ table, rows });
        return Promise.resolve({ error: null });
      },
    }),
  };
  return { admin, upserts } as any;
}
const config = { get: () => 3 } as any;

describe('AnalyticsRollupService', () => {
  it('upserts per-name daily counts from the warehouse', async () => {
    const wh = new MockWarehouseProvider();
    await wh.writeEvents([
      makeServerEvent('application.created', { user_id: 'u1' }),
      makeServerEvent('application.created', { user_id: 'u2' }),
    ]);
    const sb = fakeSupabase();
    const svc = new AnalyticsRollupService(wh, sb, config);
    await svc.recompute();
    const daily = sb.upserts.find(
      (u: any) => u.table === 'analytics_event_daily',
    );
    expect(daily).toBeTruthy();
    const created = daily.rows.find(
      (r: any) => r.name === 'application.created',
    );
    expect(created.count).toBe(2);
  });
});
