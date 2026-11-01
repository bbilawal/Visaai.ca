import { AnalyticsIngestProcessor } from './analytics-ingest.processor';
import { MockWarehouseProvider } from '../warehouse/mock-warehouse.provider';
import { makeServerEvent } from '../events/catalog';

describe('AnalyticsIngestProcessor', () => {
  it('writes a batch-job to the warehouse', async () => {
    const wh = new MockWarehouseProvider();
    const proc = new AnalyticsIngestProcessor(wh);
    const events = [makeServerEvent('user.registered', { user_id: 'u1' })];
    await proc.process({ data: { events } } as any);
    expect(wh.rows.length).toBe(1);
  });

  it('writes multiple events in one job and dedupes by event_id via the provider', async () => {
    const wh = new MockWarehouseProvider();
    const proc = new AnalyticsIngestProcessor(wh);
    const events = [
      makeServerEvent('user.registered', { user_id: 'u1' }),
      makeServerEvent('user.signed_in', { user_id: 'u1' }),
    ];
    await proc.process({ data: { events } } as any);
    expect(wh.rows.length).toBe(2);
  });

  it('is a no-op for an empty batch', async () => {
    const wh = new MockWarehouseProvider();
    const proc = new AnalyticsIngestProcessor(wh);
    await proc.process({ data: { events: [] } } as any);
    expect(wh.rows.length).toBe(0);
  });
});
