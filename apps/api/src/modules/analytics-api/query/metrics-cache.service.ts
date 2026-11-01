import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  MetricQuery,
  MetricResult,
} from '../../analytics-metrics/contracts/metric.contract';
import { CACHE_CLIENT, type CacheClient } from './cache.port';

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(',')}}`;
}

@Injectable()
export class MetricsCacheService {
  private readonly log = new Logger(MetricsCacheService.name);
  constructor(
    @Inject(CACHE_CLIENT) private readonly client: CacheClient,
    private readonly ttlSec: number,
  ) {}

  stableKey(prefix: string, query: MetricQuery): string {
    return `analytics:v1:${prefix}:${stableStringify(query)}`;
  }

  async wrap(
    key: string,
    query: MetricQuery,
    compute: () => Promise<MetricResult>,
    opts?: { fresh?: boolean },
  ): Promise<MetricResult> {
    const cacheKey = this.stableKey(key, query);
    if (!opts?.fresh) {
      try {
        const hit = await this.client.get(cacheKey);
        if (hit) return JSON.parse(hit) as MetricResult;
      } catch (e) {
        this.log.warn(`cache read failed: ${(e as Error).message}`);
      }
    }
    const value = await compute();
    try {
      await this.client.setex(cacheKey, this.ttlSec, JSON.stringify(value));
    } catch (e) {
      this.log.warn(`cache write failed: ${(e as Error).message}`);
    }
    return value;
  }
}
