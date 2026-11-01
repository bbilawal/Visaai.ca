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
import { buildResult } from '../engine/result.builder';

@Injectable()
export class AiMetricsService implements MetricService {
  readonly key = 'ai';
  readonly supportedFilters: (keyof MetricFilters)[] = [];

  constructor(
    @Inject(KPI_SOURCE_REPOSITORY) private readonly src: IKpiSourceRepository,
  ) {}

  async compute(query: MetricQuery): Promise<MetricResult> {
    return this.costPerApplication(query);
  }

  async costPerApplication(query: MetricQuery): Promise<MetricResult> {
    const q = validateQuery(query);
    assertFiltersSupported('ai_cost_per_application', q, this.supportedFilters);
    const rows = await this.src.queryAiCostPerApplication(q.from, q.to);
    return buildResult({
      metric: 'ai_cost_per_application',
      unit: 'cents',
      tier: 'live',
      rows: rows.map((r) => ({ day: r.day, value: r.costCents })),
      from: q.from,
      to: q.to,
      grain: q.grain,
    });
  }
}
