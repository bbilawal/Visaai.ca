import { Inject, Injectable, Optional } from '@nestjs/common';
import { METRIC_REGISTRY } from '../../analytics-metrics/metric.registry';
import type {
  MetricService,
  MetricQuery,
  MetricResult,
} from '../../analytics-metrics/contracts/metric.contract';
import { MetricsCacheService } from './metrics-cache.service';
import { UnknownMetricError } from '../errors/analytics-api.errors';
import { SUMMARY_METRIC_KEYS } from './summary.config';

@Injectable()
export class MetricsQueryService {
  constructor(
    @Inject(METRIC_REGISTRY)
    private readonly registry: Map<string, MetricService>,
    private readonly cache: MetricsCacheService,
    @Optional() private readonly summaryKeys: string[] = SUMMARY_METRIC_KEYS,
  ) {}

  async run(
    key: string,
    query: MetricQuery,
    opts?: { fresh?: boolean },
  ): Promise<MetricResult> {
    const svc = this.registry.get(key);
    if (!svc) throw new UnknownMetricError(key);
    return this.cache.wrap(key, query, () => svc.compute(query), opts);
  }

  async summary(
    base: MetricQuery,
  ): Promise<Record<string, MetricResult | { error: string }>> {
    const out: Record<string, MetricResult | { error: string }> = {};
    await Promise.all(
      this.summaryKeys.map(async (key) => {
        const svc = this.registry.get(key);
        if (!svc) {
          out[key] = { error: `unknown metric '${key}'` };
          return;
        }
        try {
          out[key] = await this.cache.wrap(key, base, () => svc.compute(base));
        } catch (e) {
          out[key] = { error: (e as Error).message };
        }
      }),
    );
    return out;
  }

  catalog(): { key: string; supportedFilters: string[] }[] {
    return [...this.registry.values()].map((s) => ({
      key: s.key,
      supportedFilters: [...s.supportedFilters] as string[],
    }));
  }
}
