import { AnalyticsRetentionService } from './analytics-retention.service';
import { MockWarehouseProvider } from '../warehouse/mock-warehouse.provider';
import { makeServerEvent } from '../events/catalog';

const config = { get: () => 90 } as any;

describe('AnalyticsRetentionService', () => {
  it('prunes events older than the retention window', async () => {
    const wh = new MockWarehouseProvider();
    const old = makeServerEvent('page.viewed' as any, {});
    old.occurred_at = new Date(Date.now() - 200 * 86_400_000).toISOString(); // 200d ago
    const fresh = makeServerEvent('page.viewed' as any, {});
    await wh.writeEvents([old, fresh]);
    const svc = new AnalyticsRetentionService(wh, config);
    await svc.prune();
    expect(wh.rows.length).toBe(1);
    expect(wh.rows[0].event_id).toBe(fresh.event_id);
  });
});
