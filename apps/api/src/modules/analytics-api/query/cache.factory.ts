import { Provider, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Env } from '../../../config/configuration';
import { CACHE_CLIENT, type CacheClient } from './cache.port';
import { MetricsCacheService } from './metrics-cache.service';

// ioredis on REDIS_URL — same connection the BullMQ QueueModule uses.
// The CacheClient contract (get/setex) is all MetricsCacheService needs.
export const cacheClientProvider: Provider = {
  provide: CACHE_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env>): CacheClient => {
    const url = config.get('REDIS_URL', { infer: true }) as string;
    const client = new Redis(url, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
    const log = new Logger('AnalyticsCacheClient');
    client.on('error', (e) => log.warn(`redis error: ${e.message}`));
    return {
      get: (k) => client.get(k),
      setex: async (k, ttl, v) => {
        await client.setex(k, ttl, v);
      },
    };
  },
};

export const metricsCacheProvider: Provider = {
  provide: MetricsCacheService,
  inject: [CACHE_CLIENT, ConfigService],
  useFactory: (client: CacheClient, config: ConfigService<Env>) =>
    new MetricsCacheService(
      client,
      config.get('ANALYTICS_CACHE_TTL_SEC', { infer: true }) ?? 60,
    ),
};
