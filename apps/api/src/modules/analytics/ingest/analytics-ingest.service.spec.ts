import { AnalyticsIngestService } from './analytics-ingest.service';
import { AnalyticsEventBus } from '../analytics-event-bus';
import { makeServerEvent } from '../events/catalog';

function fakeQueue() {
  const added: any[] = [];
  return {
    added,
    add: async (name: string, data: any) => {
      added.push({ name, data });
    },
  } as any;
}
function fakeConfig(batch: number) {
  return { get: () => batch } as any;
}

describe('AnalyticsIngestService', () => {
  it('chunks events into batch-jobs of ANALYTICS_INGEST_BATCH', async () => {
    const q = fakeQueue();
    const svc = new AnalyticsIngestService(
      new AnalyticsEventBus(),
      q,
      fakeConfig(2),
    );
    const events = [1, 2, 3].map(() =>
      makeServerEvent('page.viewed' as any, {}),
    );
    await svc.ingest(events);
    expect(q.added.length).toBe(2); // 2 + 1
    expect(q.added[0].data.events.length).toBe(2);
    expect(q.added[1].data.events.length).toBe(1);
  });

  it('subscribes to the bus and enqueues emitted events on init', async () => {
    const q = fakeQueue();
    const bus = new AnalyticsEventBus();
    const svc = new AnalyticsIngestService(bus, q, fakeConfig(10));
    svc.onModuleInit();
    bus.emit(makeServerEvent('user.registered', { user_id: 'u1' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(q.added.length).toBe(1);
    expect(q.added[0].data.events[0].name).toBe('user.registered');
  });

  it('does not throw or crash the process when the queue rejects (subscriber-side containment)', async () => {
    // Regression guard: an uncaught throw/unhandled rejection inside the bus's
    // `next` handler is routed by RxJS to reportUnhandledError and crashes the
    // node process (this exact failure class was already fixed once in Task 4).
    // emitSafe only protects the producer; the subscriber must contain its own
    // async failures.
    const unhandledRejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandledRejections.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
      const rejectingQueue = {
        add: async () => {
          throw new Error('queue add failed');
        },
      } as any;
      const bus = new AnalyticsEventBus();
      const svc = new AnalyticsIngestService(
        bus,
        rejectingQueue,
        fakeConfig(10),
      );

      expect(() => svc.onModuleInit()).not.toThrow();
      expect(() =>
        bus.emit(makeServerEvent('user.registered', { user_id: 'u1' })),
      ).not.toThrow();

      await new Promise((r) => setTimeout(r, 0));

      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('is a no-op for empty input', async () => {
    const q = fakeQueue();
    const svc = new AnalyticsIngestService(
      new AnalyticsEventBus(),
      q,
      fakeConfig(10),
    );
    await svc.ingest([]);
    expect(q.added.length).toBe(0);
  });
});
