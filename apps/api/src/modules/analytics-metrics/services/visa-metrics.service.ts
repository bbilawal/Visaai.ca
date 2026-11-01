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
export class VisaMetricsService implements MetricService {
  readonly key = 'visa';
  readonly supportedFilters: (keyof MetricFilters)[] = ['country', 'visa_type'];

  constructor(
    @Inject(KPI_SOURCE_REPOSITORY) private readonly src: IKpiSourceRepository,
  ) {}

  async compute(
    query: MetricQuery & { metric?: 'approval_funnel' | 'application_funnel' },
  ): Promise<MetricResult> {
    return (query.metric ?? 'approval_funnel') === 'application_funnel'
      ? this.applicationFunnel(query)
      : this.approvalFunnel(query);
  }

  private dimKey(q: MetricQuery): string {
    return q.filters?.country
      ? 'country'
      : q.filters?.visa_type
        ? 'visa_type'
        : '';
  }

  async approvalFunnel(query: MetricQuery): Promise<MetricResult<FunnelExtra>> {
    return this.funnel('approval', query);
  }
  async applicationFunnel(
    query: MetricQuery,
  ): Promise<MetricResult<FunnelExtra>> {
    return this.funnel('application', query);
  }

  private async funnel(
    name: string,
    query: MetricQuery,
  ): Promise<MetricResult<FunnelExtra>> {
    const q = validateQuery(query);
    assertFiltersSupported(
      name === 'approval' ? 'approval_funnel' : 'application_funnel',
      q,
      this.supportedFilters,
    );
    const rows = await this.src.queryFunnelDaily(
      name,
      q.from,
      q.to,
      this.dimKey(q),
    );
    const funnel = buildFunnel(rows);
    const total = funnel.steps.at(-1)?.converted ?? 0;
    return {
      metric: `${name}_funnel`,
      unit: 'count',
      total,
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
