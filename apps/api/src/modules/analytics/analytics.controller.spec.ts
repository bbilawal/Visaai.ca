// analytics.controller.spec.ts
import { AnalyticsController } from './analytics.controller';

function fakeIngest() {
  const batches: any[] = [];
  return {
    batches,
    ingest: async (events: any[]) => {
      batches.push(events);
    },
  } as any;
}
const config = { get: () => 3 } as any; // ANALYTICS_COLLECT_MAX_EVENTS = 3

describe('AnalyticsController', () => {
  it('accepts valid client events and sets user_id for a non-anon caller', async () => {
    const ingest = fakeIngest();
    const c = new AnalyticsController(ingest, config);
    const body = {
      events: [
        {
          event_id: '11111111-1111-1111-1111-111111111111',
          name: 'page.viewed',
          occurred_at: new Date().toISOString(),
          anonymous_id: 'anon-1',
          props: { path: '/pricing' },
        },
      ],
    };
    const user = { id: 'u1', isAnonymous: false } as any;
    const res = await c.collect(body, user);
    expect(res.accepted).toBe(1);
    expect(ingest.batches[0][0].user_id).toBe('u1');
  });

  it('drops invalid events without error and caps the batch', async () => {
    const ingest = fakeIngest();
    const c = new AnalyticsController(ingest, config);
    const good = {
      event_id: '22222222-2222-2222-2222-222222222222',
      name: 'feature.used',
      occurred_at: new Date().toISOString(),
      props: {},
    };
    const body = { events: [good, { name: 'evil.event' }, good, good, good] }; // 5 → capped 3
    const user = { id: 'anon', isAnonymous: true } as any;
    const res = await c.collect(body, user);
    expect(res.accepted).toBeLessThanOrEqual(3);
    expect(ingest.batches[0].every((e: any) => e.user_id === null)).toBe(true);
  });
});
