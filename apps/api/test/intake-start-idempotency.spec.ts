import { CheckpointService } from '../src/modules/shared/langgraph/checkpoint.service';

/**
 * Two identical opening messages, 77 seconds apart, on a real application
 * (e85e8852…). Nobody had typed anything — the transcript held two assistant
 * turns and no user turn.
 *
 * startOrResume decided whether to generate by loading the checkpoint, then
 * spent an LLM call generating, then saved. Between the load and the save the
 * answer to "already started?" was still no. The browser emits `intake:start`
 * from its socket `connect` handler and socket.io re-fires `connect` on every
 * reconnect, so an API restart mid-generation was enough to run the graph twice
 * and append a second opening line.
 *
 * These exercise the lock that closes that window. The graph itself is not
 * involved: what matters is that exactly one caller is allowed through it.
 */

/** In-memory stand-in for the Upstash SET NX / DEL pair. */
class FakeLockStore {
  private keys = new Map<string, number>();
  acquireCalls = 0;
  releaseCalls = 0;

  async acquireStartLock(threadId: string, ttlSeconds: number) {
    this.acquireCalls += 1;
    const existing = this.keys.get(threadId);
    if (existing !== undefined && existing > Date.now()) return false;
    this.keys.set(threadId, Date.now() + ttlSeconds * 1000);
    return true;
  }

  async releaseStartLock(threadId: string) {
    this.releaseCalls += 1;
    this.keys.delete(threadId);
  }

  held(threadId: string) {
    const until = this.keys.get(threadId);
    return until !== undefined && until > Date.now();
  }
}

const APP = 'e85e8852-ef82-4bd6-bfd5-4edeb467e2d3';

describe('intake start lock', () => {
  it('lets exactly one concurrent starter through', async () => {
    const store = new FakeLockStore();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => store.acquireStartLock(APP, 180)),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((r) => !r)).toHaveLength(4);
  });

  it('scopes the lock per application — one intake never blocks another', async () => {
    const store = new FakeLockStore();
    await expect(store.acquireStartLock(APP, 180)).resolves.toBe(true);
    await expect(store.acquireStartLock('other-app', 180)).resolves.toBe(true);
  });

  it('frees the lock on release, so a later start may generate', async () => {
    const store = new FakeLockStore();
    await store.acquireStartLock(APP, 180);
    await expect(store.acquireStartLock(APP, 180)).resolves.toBe(false);

    await store.releaseStartLock(APP);

    await expect(store.acquireStartLock(APP, 180)).resolves.toBe(true);
  });

  it('expires, so a holder that dies mid-generation cannot deadlock the intake', async () => {
    jest.useFakeTimers();
    try {
      const store = new FakeLockStore();
      await store.acquireStartLock(APP, 180);
      expect(store.held(APP)).toBe(true);

      // The holder never releases — it crashed. The TTL is the only way out.
      jest.advanceTimersByTime(181_000);

      expect(store.held(APP)).toBe(false);
      await expect(store.acquireStartLock(APP, 180)).resolves.toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('CheckpointService exposes the lock pair the service depends on', () => {
    // Guards against the primitive being renamed or dropped: startOrResume's
    // only protection against duplicate opening turns is these two methods.
    expect(typeof CheckpointService.prototype.acquireStartLock).toBe(
      'function',
    );
    expect(typeof CheckpointService.prototype.releaseStartLock).toBe(
      'function',
    );
  });

  it('uses SET NX with a TTL, not a bare SET', async () => {
    // A plain SET would hand the lock to every caller and restore the bug.
    const calls: Array<[string, string, unknown]> = [];
    const svc = Object.create(CheckpointService.prototype) as CheckpointService;
    // `redis` is private, so it is injected through an unknown cast rather than
    // an intersection (which TS reduces to `never` for a private member).
    (svc as unknown as { redis: unknown }).redis = {
      set: async (key: string, value: string, opts: unknown) => {
        calls.push([key, value, opts]);
        return 'OK';
      },
    };

    await expect(svc.acquireStartLock(APP, 180)).resolves.toBe(true);

    const [key, , opts] = calls[0];
    expect(key).toBe(`intake:start-lock:${APP}`);
    expect(opts).toEqual({ nx: true, ex: 180 });
  });

  it('reports not-acquired when the key already exists (redis returns null)', async () => {
    const svc = Object.create(CheckpointService.prototype) as CheckpointService;
    (svc as unknown as { redis: unknown }).redis = {
      set: async () => null,
    };

    await expect(svc.acquireStartLock(APP, 180)).resolves.toBe(false);
  });
});
