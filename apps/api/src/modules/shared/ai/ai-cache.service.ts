import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from '@upstash/redis';
import type { Env } from '../../../config/configuration';
import { AI_TASKS, type AiTaskName } from './task-registry';
import { aiCacheKey, aiCacheTtl, type CacheKeyParts } from './ai-cache.key';

/**
 * Application-level cache for AI results.
 *
 * `task-registry.ts` has declared `cacheable` and a TTL on every task since the
 * routing layer landed, and nothing read either. This reads them.
 *
 * WHAT IT IS FOR, concretely: the nightly sync re-reads hundreds of government
 * pages whose bytes have not changed. `source_normalization` over an unchanged
 * source version is the same question with the same answer every night, and it
 * is the most expensive task in the registry. Caching it is the difference
 * between paying for that work once per version and paying for it once per run.
 *
 * FAIL-OPEN, ALWAYS. Every failure path returns "no cached value" and lets the
 * caller make the real call. A cache that can break a feature is a liability,
 * and the thing being cached costs money but is never irreplaceable.
 *
 * The one thing it will NOT do is serve a task the registry marks uncacheable.
 * That check lives in `aiCacheKey`, which returns null, and this service
 * treats null as "no cache" rather than falling back to some other key — so a
 * caller cannot cache a personalized answer by passing the wrong arguments.
 */

export interface CacheStats {
  hits: number;
  misses: number;
  writes: number;
  errors: number;
}

@Injectable()
export class AiCacheService {
  private readonly log = new Logger(AiCacheService.name);
  private redis: Redis | null = null;

  /**
   * Process-lifetime counters. Deliberately not persisted: they answer "is the
   * cache working right now", which is what an operator asks. The durable
   * version of the question is answered by ai_usage_events, where a cache hit
   * shows up as a call that never happened.
   */
  private readonly stats: CacheStats = {
    hits: 0,
    misses: 0,
    writes: 0,
    errors: 0,
  };

  constructor(
    @Optional() config?: ConfigService<Env>,
    /** Injected in tests. Skips the config path entirely. */
    @Optional() redis?: Redis,
  ) {
    if (redis) {
      this.redis = redis;
      return;
    }
    const url = config?.get('UPSTASH_REDIS_REST_URL', { infer: true });
    const token = config?.get('UPSTASH_REDIS_REST_TOKEN', { infer: true });
    // No Redis configured is a supported state, not an error: local development
    // and CI run without it, and every method degrades to a miss.
    if (url && token) this.redis = new Redis({ url, token });
  }

  get enabled(): boolean {
    return this.redis !== null;
  }

  getStats(): CacheStats & { hitRate: number } {
    const lookups = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      hitRate: lookups === 0 ? 0 : this.stats.hits / lookups,
    };
  }

  /**
   * Read a cached result. `null` means call the model.
   *
   * The value is returned as the string the caller stored, not parsed: parsing
   * belongs to the caller that knows the task's schema, and a parse failure
   * here would be indistinguishable from a miss.
   *
   * WHY THE RE-STRINGIFY BELOW IS NOT DEFENSIVE PADDING
   *
   * `@upstash/redis` deserializes responses by default, so a value stored as
   * `JSON.stringify(result)` comes back as an OBJECT, not the string that was
   * written. This method used to require `typeof value === 'string'` and count
   * anything else as a miss — which meant every cacheable task whose payload is
   * JSON missed on every single read, forever. Writes still landed, so the
   * cache looked alive from the outside: production held four
   * `intake_checklist_discovery` keys while twelve consecutive rebuilds of the
   * same four routes each paid a full generation (measured 2026-09-05:
   * 11.8-16.1s cold, 7.4-20.2s "warm", item counts differing run to run — the
   * signature of a model call, not a cache hit).
   *
   * Nothing caught it because the unit test's Redis stand-in returned exactly
   * what it was given. The fake now deserializes the way the real client does,
   * so this behaviour is pinned from both sides.
   */
  async get(parts: CacheKeyParts): Promise<string | null> {
    const key = aiCacheKey(parts);
    if (!key || !this.redis) {
      this.stats.misses++;
      return null;
    }
    try {
      const value = await this.redis.get<unknown>(key);
      // Re-stringify whatever came back so the caller always receives the same
      // text it stored. Lossless for JSON payloads, which is all a structured
      // task ever writes, and a plain string the client could not parse arrives
      // as a string and passes through untouched.
      const text =
        typeof value === 'string'
          ? value
          : value === null || value === undefined
            ? null
            : JSON.stringify(value);
      if (text !== null && text.length > 0) {
        this.stats.hits++;
        return text;
      }
      this.stats.misses++;
      return null;
    } catch (err) {
      // A Redis outage must not take the AI path down with it.
      this.stats.errors++;
      this.stats.misses++;
      this.log.warn(
        `cache read failed for ${parts.task}: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      return null;
    }
  }

  /**
   * Store a result. Silently does nothing for an uncacheable task.
   *
   * Refuses an empty value: an empty string is what a failed generation looks
   * like, and caching it would serve that failure for the whole TTL — up to 90
   * days for source_normalization.
   */
  async set(parts: CacheKeyParts, value: string): Promise<void> {
    const key = aiCacheKey(parts);
    if (!key || !this.redis) return;
    if (!value || value.trim().length === 0) return;

    const ttl = aiCacheTtl(parts.task);
    if (ttl <= 0) return;

    try {
      await this.redis.set(key, value, { ex: ttl });
      this.stats.writes++;
    } catch (err) {
      this.stats.errors++;
      this.log.warn(
        `cache write failed for ${parts.task}: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }

  /**
   * Read-through: return the cached value or produce, store and return a new
   * one. The shape most callers want, because it makes the miss path the
   * default rather than something to remember.
   */
  async wrap(
    parts: CacheKeyParts,
    produce: () => Promise<string>,
  ): Promise<{ value: string; cached: boolean }> {
    const hit = await this.get(parts);
    if (hit !== null) return { value: hit, cached: true };

    const value = await produce();
    await this.set(parts, value);
    return { value, cached: false };
  }

  /**
   * Drop every entry for a task. For a prompt change that must take effect
   * before the TTL expires.
   *
   * Uses SCAN rather than KEYS: this shares a Redis instance with the LangGraph
   * checkpoints, and KEYS blocks the server for the duration of the scan.
   */
  async invalidateTask(task: AiTaskName): Promise<number> {
    if (!this.redis) return 0;
    const pattern = `ai:${task}:*`;
    let cursor = 0;
    let removed = 0;
    try {
      do {
        const [next, keys] = await this.redis.scan(cursor, {
          match: pattern,
          count: 200,
        });
        cursor = Number(next);
        if (keys.length > 0) {
          await this.redis.del(...keys);
          removed += keys.length;
        }
      } while (cursor !== 0);
    } catch (err) {
      this.stats.errors++;
      this.log.warn(
        `cache invalidation failed for ${task}: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
    return removed;
  }

  /** Tasks the registry permits caching. For the operational report. */
  static cacheableTasks(): AiTaskName[] {
    return (Object.keys(AI_TASKS) as AiTaskName[]).filter(
      (t) => AI_TASKS[t].cacheable,
    );
  }
}
