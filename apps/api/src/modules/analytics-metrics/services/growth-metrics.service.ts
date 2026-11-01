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
import { bucketize } from '../engine/bucketing';
import { rollupStaleMinutes } from '../engine/kpi-staleness';
import { Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/configuration';

@Injectable()
export class GrowthMetricsService implements MetricService {
  readonly key = 'growth';
  readonly supportedFilters: (keyof MetricFilters)[] = [];

  constructor(
    @Inject(KPI_SOURCE_REPOSITORY) private readonly src: IKpiSourceRepository,
    // CONFIG-004: optional so unit tests may construct without config.
    @Optional() private readonly config?: ConfigService<Env>,
  ) {}

  async compute(
    query: MetricQuery & { metric?: 'dau' | 'wau' | 'mau' },
  ): Promise<MetricResult> {
    switch (query.metric ?? 'dau') {
      case 'wau':
        return this.wau(query);
      case 'mau':
        return this.mau(query);
      default:
        return this.dau(query);
    }
  }

  async dau(query: MetricQuery): Promise<MetricResult> {
    return this.active(query, 'dau');
  }
  async wau(query: MetricQuery): Promise<MetricResult> {
    return this.active(query, 'wau');
  }

  private async active(
    query: MetricQuery,
    field: 'dau' | 'wau',
  ): Promise<MetricResult> {
    const q = validateQuery(query);
    assertFiltersSupported(field, q, this.supportedFilters);
    const rows = await this.src.queryDailyActive(q.from, q.to);
    const mapped = rows.map((r) => ({ day: r.day, value: r[field] }));
    return buildResult({
      metric: field,
      unit: 'count',
      tier: 'rollup',
      rows: mapped,
      from: q.from,
      to: q.to,
      grain: q.grain,
      slaMinutes: rollupStaleMinutes(this.config),
    });
  }

  async mau(query: MetricQuery): Promise<MetricResult> {
    // MAU is a trailing-window snapshot: series is the daily MAU line; total is the latest day's value.
    const q = validateQuery(query);
    assertFiltersSupported('mau', q, this.supportedFilters);
    const rows = await this.src.queryDailyActive(q.from, q.to);
    const series = bucketize(
      rows.map((r) => ({ day: r.day, value: r.mau })),
      q.from,
      q.to,
      q.grain,
    );
    const latest = rows.length
      ? [...rows].sort((a, b) => a.day.localeCompare(b.day)).at(-1)!.mau
      : 0;
    return {
      metric: 'mau',
      unit: 'count',
      total: latest,
      series,
      meta: { computedAt: new Date().toISOString(), tier: 'rollup' },
    };
  }
}
