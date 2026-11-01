import type { Redis } from '@upstash/redis';
import { AiCacheService } from './ai-cache.service';
import { aiCacheKey, aiCacheTtl, CACHE_KEY_VERSION } from './ai-cache.key';
import { AI_TASKS } from './task-registry';

/**
 * In-memory Redis stand-in. Records TTLs so expiry policy is assertable.
 *
 * IT DESERIALIZES ON READ, BECAUSE THE REAL CLIENT DOES.
 *
 * `@upstash/redis` runs responses through `JSON.parse` unless
 * `automaticDeserialization` is switched off, so a value written as
 * `JSON.stringify(obj)` is handed back as an object. The earlier fake returned
 * whatever it was given, which made every test here agree with a production
 * cache that missed on every read of a JSON payload — the round-trip test
 * passed while no cacheable structured task had ever served a hit.
 */
function fakeRedis(opts: { failOn?: 'get' | 'set' | 'scan' } = {}) {
  const store = new Map<string, { value: string; ttl: number }>();
  const redis = {
    get: async (k: string) => {
      if (opts.failOn === 'get') throw new Error('redis down');
      const raw = store.get(k)?.value;
      if (raw === undefined) return null;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        // Not JSON: the real client leaves it as the stored string.
        return raw;
      }
    },
    set: async (k: string, v: string, o?: { ex?: number }) => {
      if (opts.failOn === 'set') throw new Error('redis down');
      store.set(k, { value: v, ttl: o?.ex ?? 0 });
      return 'OK';
    },
    scan: async (cursor: number, o: { match: string }) => {
      if (opts.failOn === 'scan') throw new Error('redis down');
      const re = new RegExp(
        `^${o.match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*')}$`,
      );
      return [0, [...store.keys()].filter((k) => re.test(k))] as [
        number,
        string[],
      ];
    },
    del: async (...keys: string[]) => {
      keys.forEach((k) => store.delete(k));
      return keys.length;
    },
  } as unknown as Redis;
  return { redis, store };
}

const base = {
  task: 'source_normalization' as const,
  input: 'a government page',
};

describe('aiCacheKey', () => {
  it('refuses a task the registry marks uncacheable', () => {
    // The guard that stops a personalized answer being cached by passing the
    // wrong arguments. user_draft_generation depends on live applicant facts.
    expect(AI_TASKS.user_draft_generation.cacheable).toBe(false);
    expect(
      aiCacheKey({ task: 'user_draft_generation', input: 'x' }),
    ).toBeNull();
  });

  it('returns a stable key for identical inputs', () => {
    expect(aiCacheKey(base)).toBe(aiCacheKey({ ...base }));
  });

  it('changes when the input changes', () => {
    expect(aiCacheKey(base)).not.toBe(
      aiCacheKey({ ...base, input: 'a different page' }),
    );
  });

  it('changes when the source version changes', () => {
    // The one that matters most: an explanation derived from version 3 of a
    // government page must not survive into version 4.
    expect(aiCacheKey({ ...base, sourceVersionId: 'v3' })).not.toBe(
      aiCacheKey({ ...base, sourceVersionId: 'v4' }),
    );
  });

  it('changes when the locale changes', () => {
    expect(aiCacheKey({ ...base, locale: 'en' })).not.toBe(
      aiCacheKey({ ...base, locale: 'fr' }),
    );
  });

  it('changes when the resolved model changes', () => {
    // Keyed on the MODEL, not the tier name, so pinning a tier to a different
    // model invalidates rather than silently reusing another model's answer.
    expect(aiCacheKey(base)).not.toBe(
      aiCacheKey({ ...base, overrides: { balanced: 'gpt-4o' } }),
    );
  });

  it('changes when the output schema version changes', () => {
    expect(aiCacheKey({ ...base, schemaVersion: 's1' })).not.toBe(
      aiCacheKey({ ...base, schemaVersion: 's2' }),
    );
  });

  it('cannot be collided by shifting a delimiter between components', () => {
    // {sourceVersion: 'a', locale: 'b'} must not equal {sourceVersion: 'a b'}.
    expect(aiCacheKey({ ...base, sourceVersionId: 'a', locale: 'b' })).not.toBe(
      aiCacheKey({ ...base, sourceVersionId: 'a b' }),
    );
  });

  it('namespaces by task so one task can be flushed alone', () => {
    expect(aiCacheKey(base)!.startsWith('ai:source_normalization:')).toBe(true);
  });

  it('carries a key version, so the whole cache can be retired at once', () => {
    expect(CACHE_KEY_VERSION).toBeTruthy();
  });
});

describe('aiCacheTtl', () => {
  it('returns 0 for an uncacheable task', () => {
    expect(aiCacheTtl('user_draft_generation')).toBe(0);
  });

  it('returns the registry TTL for a cacheable one', () => {
    expect(aiCacheTtl('source_normalization')).toBe(
      AI_TASKS.source_normalization.cacheTtlSeconds,
    );
  });
});

describe('AiCacheService', () => {
  it('reports disabled and always misses with no Redis', async () => {
    const svc = new AiCacheService();
    expect(svc.enabled).toBe(false);
    expect(await svc.get(base)).toBeNull();
    // Must not throw — running without Redis is a supported state.
    await expect(svc.set(base, 'value')).resolves.toBeUndefined();
  });

  it('round-trips a value and applies the registry TTL', async () => {
    const { redis, store } = fakeRedis();
    const svc = new AiCacheService(undefined, redis);
    await svc.set(base, 'the answer');
    expect(await svc.get(base)).toBe('the answer');
    expect([...store.values()][0].ttl).toBe(
      AI_TASKS.source_normalization.cacheTtlSeconds,
    );
  });

  it('round-trips a JSON payload, which is what every structured task stores', async () => {
    // THE BUG THIS PINS. Every cacheable structured task writes
    // `JSON.stringify(result)`, and the real client parses it back into an
    // object on read. `get` demanded a string and counted an object as a miss,
    // so `intake_checklist_discovery` and `source_normalization` never served a
    // single hit in production while their keys sat in Redis looking healthy.
    const { redis } = fakeRedis();
    const svc = new AiCacheService(undefined, redis);
    const payload = JSON.stringify({
      required_forms: [{ form_code: 'AR1', form_name: 'Pay Limit Scheme' }],
      required_documents: [],
    });

    await svc.set(base, payload);
    const hit = await svc.get(base);

    expect(hit).not.toBeNull();
    // The caller parses what it gets, so the object must survive intact.
    expect(JSON.parse(hit as string)).toEqual(JSON.parse(payload));
    expect(svc.getStats().hits).toBe(1);
    expect(svc.getStats().misses).toBe(0);
  });

  it('counts a JSON hit as a hit, so the hit rate stops reading as 0%', async () => {
    // The operator-facing half: `getStats().hitRate` was pinned at 0 for the
    // one workload the cache exists to serve, and looked like a cold cache
    // rather than a broken read path.
    const { redis } = fakeRedis();
    const svc = new AiCacheService(undefined, redis);
    await svc.set(base, JSON.stringify({ normalized: 'text' }));

    await svc.get(base);
    await svc.get(base);

    expect(svc.getStats().hitRate).toBe(1);
  });

  it('never stores a value for an uncacheable task', async () => {
    const { redis, store } = fakeRedis();
    const svc = new AiCacheService(undefined, redis);
    await svc.set(
      { task: 'user_draft_generation', input: 'x' },
      'a personalized letter',
    );
    expect(store.size).toBe(0);
  });

  it('refuses to cache an empty value', async () => {
    // An empty string is what a failed generation looks like. Caching it would
    // serve that failure for up to 90 days.
    const { redis, store } = fakeRedis();
    const svc = new AiCacheService(undefined, redis);
    await svc.set(base, '');
    await svc.set(base, '   ');
    expect(store.size).toBe(0);
  });

  it('fails open on a read error', async () => {
    const { redis } = fakeRedis({ failOn: 'get' });
    const svc = new AiCacheService(undefined, redis);
    expect(await svc.get(base)).toBeNull();
    expect(svc.getStats().errors).toBe(1);
  });

  it('fails open on a write error rather than failing the call', async () => {
    const { redis } = fakeRedis({ failOn: 'set' });
    const svc = new AiCacheService(undefined, redis);
    await expect(svc.set(base, 'v')).resolves.toBeUndefined();
    expect(svc.getStats().errors).toBe(1);
  });

  describe('wrap', () => {
    it('calls the producer once, then serves from cache', async () => {
      const { redis } = fakeRedis();
      const svc = new AiCacheService(undefined, redis);
      let calls = 0;
      const produce = async () => {
        calls++;
        return 'expensive';
      };

      const first = await svc.wrap(base, produce);
      const second = await svc.wrap(base, produce);

      expect(first).toEqual({ value: 'expensive', cached: false });
      expect(second).toEqual({ value: 'expensive', cached: true });
      expect(calls).toBe(1);
    });

    it('calls the producer every time for an uncacheable task', async () => {
      const { redis } = fakeRedis();
      const svc = new AiCacheService(undefined, redis);
      let calls = 0;
      const parts = { task: 'user_draft_generation' as const, input: 'x' };
      await svc.wrap(parts, async () => {
        calls++;
        return 'a';
      });
      await svc.wrap(parts, async () => {
        calls++;
        return 'a';
      });
      expect(calls).toBe(2);
    });

    it('does not serve one source version’s answer for another', async () => {
      const { redis } = fakeRedis();
      const svc = new AiCacheService(undefined, redis);
      await svc.wrap(
        { ...base, sourceVersionId: 'v3' },
        async () => 'answer for v3',
      );
      const next = await svc.wrap(
        { ...base, sourceVersionId: 'v4' },
        async () => 'answer for v4',
      );
      expect(next).toEqual({ value: 'answer for v4', cached: false });
    });
  });

  it('tracks a hit rate an operator can read', async () => {
    const { redis } = fakeRedis();
    const svc = new AiCacheService(undefined, redis);
    await svc.wrap(base, async () => 'v'); // miss + write
    await svc.wrap(base, async () => 'v'); // hit
    await svc.wrap(base, async () => 'v'); // hit
    const s = svc.getStats();
    expect(s.hits).toBe(2);
    expect(s.misses).toBe(1);
    expect(s.writes).toBe(1);
    expect(s.hitRate).toBeCloseTo(2 / 3);
  });

  describe('invalidateTask', () => {
    it('removes only that task’s entries', async () => {
      const { redis, store } = fakeRedis();
      const svc = new AiCacheService(undefined, redis);
      await svc.set(base, 'a');
      await svc.set({ task: 'change_classification', input: 'diff' }, 'b');
      // A neighbour that shares the Redis instance and must survive.
      store.set('intake:checkpoint:thread-1', { value: 'graph state', ttl: 0 });

      const removed = await svc.invalidateTask('source_normalization');

      expect(removed).toBe(1);
      expect(await svc.get(base)).toBeNull();
      expect(
        await svc.get({ task: 'change_classification', input: 'diff' }),
      ).toBe('b');
      expect(store.has('intake:checkpoint:thread-1')).toBe(true);
    });

    it('fails open when scanning breaks', async () => {
      const { redis } = fakeRedis({ failOn: 'scan' });
      const svc = new AiCacheService(undefined, redis);
      expect(await svc.invalidateTask('source_normalization')).toBe(0);
    });
  });

  it('lists exactly the tasks the registry permits caching', () => {
    const listed = AiCacheService.cacheableTasks();
    expect(listed).toContain('source_normalization');
    expect(listed).not.toContain('user_draft_generation');
    for (const t of listed) expect(AI_TASKS[t].cacheable).toBe(true);
  });
});
