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
import {
  rollupStaleMinutes,
  cohortStaleMinutes,
} from '../engine/kpi-staleness';
import { Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/configuration';

@Injectable()
export class RetentionMetricsService implements MetricService {
  readonly key = 'retention';
  readonly supportedFilters: (keyof MetricFilters)[] = ['plan', 'country'];

  constructor(
    @Inject(KPI_SOURCE_REPOSITORY) private readonly src: IKpiSourceRepository,
    // CONFIG-004: optional so unit tests may construct without config.
    @Optional() private readonly config?: ConfigService<Env>,
  ) {}

  async compute(
    query: MetricQuery & { metric?: string; arpuCents?: number },
  ): Promise<MetricResult> {
    switch (query.metric ?? 'churn') {
      case 'churn_rate':
        return this.churnRate(query);
      case 'ltv':
        return this.ltv(query);
      case 'nrr':
        return this.nrr(query);
      default:
        return this.churn(query);
    }
  }

  private dimKey(q: MetricQuery): string {
    return q.filters?.plan ? 'plan' : q.filters?.country ? 'country' : '';
  }

  async churn(query: MetricQuery): Promise<MetricResult> {
    const q = validateQuery(query);
    assertFiltersSupported('churn', q, this.supportedFilters);
    const rows = await this.src.queryMetricDaily(
      'churn_total',
      q.from,
      q.to,
      this.dimKey(q),
    );
    return buildResult({
      metric: 'churn_total',
      unit: 'count',
      tier: 'rollup',
      rows: rows.map((r) => ({ day: r.day, value: r.value })),
      from: q.from,
      to: q.to,
      grain: q.grain,
      slaMinutes: rollupStaleMinutes(this.config),
    });
  }

  private async churnRateValue(q: MetricQuery): Promise<number> {
    const [churn, active] = await Promise.all([
      this.src.queryMetricDaily('churn_total', q.from, q.to, this.dimKey(q)),
      this.src.queryMetricDaily('active_start', q.from, q.to, this.dimKey(q)),
    ]);
    const churned = churn.reduce((s, r) => s + r.value, 0);
    const base = active.reduce((s, r) => s + r.value, 0);
    return base === 0 ? 0 : churned / base;
  }

  async churnRate(query: MetricQuery): Promise<MetricResult> {
    const q = validateQuery(query);
    assertFiltersSupported('churn_rate', q, this.supportedFilters);
    const rate = await this.churnRateValue(q);
    return buildResult({
      metric: 'churn_rate',
      unit: 'ratio',
      tier: 'derived',
      rows: [{ day: q.to, value: rate }],
      from: q.from,
      to: q.to,
      grain: q.grain,
    });
  }

  async ltv(
    query: MetricQuery & { arpuCents?: number },
  ): Promise<MetricResult> {
    const q = validateQuery(query);
    assertFiltersSupported('ltv', q, this.supportedFilters);
    const rate = await this.churnRateValue(q);
    const arpu = query.arpuCents ?? 0;
    const value = rate === 0 ? 0 : Math.round(arpu / rate);
    return buildResult({
      metric: 'ltv',
      unit: 'cents',
      tier: 'derived',
      rows: [{ day: q.to, value }],
      from: q.from,
      to: q.to,
      grain: q.grain,
    });
  }

  async nrr(query: MetricQuery): Promise<MetricResult> {
    const q = validateQuery(query);
    assertFiltersSupported('nrr', q, this.supportedFilters);
    const rows = await this.src.queryRetentionCohort(
      q.from,
      q.to,
      this.dimKey(q),
    );
    const startCents = rows
      .filter((r) => r.periodIndex === 0)
      .reduce((s, r) => s + r.retainedCents, 0);
    const latestByCohort = new Map<string, { p: number; cents: number }>();
    for (const r of rows) {
      const cur = latestByCohort.get(r.cohortMonth);
      if (!cur || r.periodIndex > cur.p)
        latestByCohort.set(r.cohortMonth, {
          p: r.periodIndex,
          cents: r.retainedCents,
        });
    }
    const retainedCents = [...latestByCohort.values()].reduce(
      (s, v) => s + v.cents,
      0,
    );
    const value = startCents === 0 ? 0 : retainedCents / startCents;
    return buildResult({
      metric: 'nrr',
      unit: 'ratio',
      tier: 'rollup',
      rows: [{ day: q.to, value }],
      from: q.from,
      to: q.to,
      grain: q.grain,
      slaMinutes: cohortStaleMinutes(this.config),
    });
  }
}
