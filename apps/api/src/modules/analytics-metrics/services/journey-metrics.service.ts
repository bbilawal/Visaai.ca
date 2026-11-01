import { Inject, Injectable } from '@nestjs/common';
import {
  KPI_SOURCE_REPOSITORY,
  type IKpiSourceRepository,
} from '../source/kpi-source.repository';
import type {
  MetricQuery,
  MetricResult,
  MetricService,
  MetricFilters,
} from '../contracts/metric.contract';
import {
  validateQuery,
  assertFiltersSupported,
} from '../contracts/metric.query.schema';
import { buildFunnel } from '../engine/funnel.builder';

type FunnelExtra = ReturnType<typeof buildFunnel>;

@Injectable()
export class JourneyMetricsService implements MetricService {
  readonly key = 'journey';
  readonly supportedFilters: (keyof MetricFilters)[] = [];

  constructor(
    @Inject(KPI_SOURCE_REPOSITORY) private readonly src: IKpiSourceRepository,
  ) {}

  async compute(query: MetricQuery): Promise<MetricResult> {
    return this.activationFunnel(query);
  }

  async activationFunnel(
    query: MetricQuery,
  ): Promise<MetricResult<FunnelExtra>> {
    const q = validateQuery(query);
    assertFiltersSupported('activation_funnel', q, this.supportedFilters);
    const rows = await this.src.queryFunnelDaily(
      'activation',
      q.from,
      q.to,
      '',
    );
    const funnel = buildFunnel(rows);
    // Degrades gracefully: unwired activation events => no rows => total 0, stale true (not an error).
    return {
      metric: 'activation_funnel',
      unit: 'count',
      total: funnel.steps.at(-1)?.converted ?? 0,
      series: funnel.steps.map((s) => ({ bucket: s.step, value: s.converted })),
      meta: {
        computedAt: new Date().toISOString(),
        tier: 'rollup',
        stale: rows.length === 0,
      },
      extra: funnel,
    };
  }
}
