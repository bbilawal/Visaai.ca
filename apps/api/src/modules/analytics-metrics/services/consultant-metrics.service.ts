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
import { rollupStaleMinutes } from '../engine/kpi-staleness';
import { Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/configuration';

// COR-1: take-rate authority = marketplace commission rules (via commission.engine.split in the
// rollup job). pricing_constants.take_rate is intentionally NOT read here.
@Injectable()
export class ConsultantMetricsService implements MetricService {
  readonly key = 'consultant';
  readonly supportedFilters: (keyof MetricFilters)[] = ['consultant_id'];

  constructor(
    @Inject(KPI_SOURCE_REPOSITORY) private readonly src: IKpiSourceRepository,
    // CONFIG-004: optional so unit tests may construct without config.
    @Optional() private readonly config?: ConfigService<Env>,
  ) {}

  async compute(
    query: MetricQuery & { metric?: 'payout' | 'take_rate' | 'leaderboard' },
  ): Promise<MetricResult> {
    switch (query.metric ?? 'payout') {
      case 'take_rate':
        return this.takeRate(query);
      case 'leaderboard':
        return this.leaderboard(query);
      default:
        return this.payout(query);
    }
  }

  async payout(query: MetricQuery): Promise<MetricResult> {
    const q = validateQuery(query);
    assertFiltersSupported('payout', q, this.supportedFilters);
    const dimKey = q.filters?.consultant_id ? 'consultant_id' : '';
    const rows = await this.src.queryMetricDaily(
      'consultant_payout',
      q.from,
      q.to,
      dimKey,
    );
    return buildResult({
      metric: 'consultant_payout',
      unit: 'cents',
      tier: 'rollup',
      rows: rows.map((r) => ({ day: r.day, value: r.value })),
      from: q.from,
      to: q.to,
      grain: q.grain,
      slaMinutes: rollupStaleMinutes(this.config),
    });
  }

  async takeRate(query: MetricQuery): Promise<MetricResult> {
    const q = validateQuery(query);
    assertFiltersSupported('take_rate', q, this.supportedFilters);
    const [gross, payout] = await Promise.all([
      this.src.queryMetricDaily('consultant_gross', q.from, q.to, ''),
      this.src.queryMetricDaily('consultant_payout', q.from, q.to, ''),
    ]);
    const g = gross.reduce((s, r) => s + r.value, 0);
    const p = payout.reduce((s, r) => s + r.value, 0);
    const rate = g === 0 ? 0 : (g - p) / g;
    return buildResult({
      metric: 'take_rate',
      unit: 'ratio',
      tier: 'derived',
      rows: [{ day: q.to, value: rate }],
      from: q.from,
      to: q.to,
      grain: q.grain,
    });
  }

  async leaderboard(query: MetricQuery): Promise<MetricResult> {
    const q = validateQuery(query);
    assertFiltersSupported('leaderboard', q, this.supportedFilters);
    const rows = await this.src.queryMetricDaily(
      'consultant_payout',
      q.from,
      q.to,
      'consultant_id',
    );
    const byConsultant = new Map<string, number>();
    for (const r of rows)
      byConsultant.set(r.dimVal, (byConsultant.get(r.dimVal) ?? 0) + r.value);
    const byDimension = [...byConsultant.entries()]
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 20);
    const total = byDimension.reduce((s, d) => s + d.value, 0);
    return {
      metric: 'consultant_leaderboard',
      unit: 'cents',
      total,
      series: [],
      byDimension,
      meta: { computedAt: new Date().toISOString(), tier: 'rollup' },
    };
  }
}
