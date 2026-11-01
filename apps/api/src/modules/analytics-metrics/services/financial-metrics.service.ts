import { Inject, Injectable, Optional } from '@nestjs/common';
import { BillingAnalyticsService } from '../../billing-analytics/billing-analytics.service';
import { FinancialReportService } from '../../financial-ops/financial-report.service';
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
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/configuration';

type FinancialMetric =
  | 'mrr'
  | 'arr'
  | 'revenue'
  | 'at_risk'
  | 'mrr_trend'
  | 'margin';

/** Adapters over sibling services so Phase 2 does not hard-depend on later phases. */
export interface FinancialDeps {
  payoutCents: (from: string, to: string) => Promise<number>;
  aiCostCents: (from: string, to: string) => Promise<number>;
}

@Injectable()
export class FinancialMetricsService implements MetricService {
  readonly key = 'financial';
  readonly supportedFilters: (keyof MetricFilters)[] = ['plan', 'country'];

  constructor(
    private readonly billing: BillingAnalyticsService,
    private readonly reports: FinancialReportService,
    @Inject(KPI_SOURCE_REPOSITORY) private readonly src: IKpiSourceRepository,
    // FinancialDeps is an interface — no runtime DI token exists for it, so Nest
    // must be told to skip injection and fall through to the safe default.
    @Optional()
    private readonly deps: FinancialDeps = {
      payoutCents: async () => 0,
      aiCostCents: async () => 0,
    },
    // CONFIG-004: optional so unit tests may construct without config.
    @Optional() private readonly config?: ConfigService<Env>,
  ) {}

  async compute(
    query: MetricQuery & { metric?: FinancialMetric },
  ): Promise<MetricResult> {
    switch (query.metric ?? 'mrr') {
      case 'arr':
        return this.arr(query);
      case 'revenue':
        return this.revenue(query);
      case 'at_risk':
        return this.atRisk(query);
      case 'mrr_trend':
        return this.mrrTrend(query);
      case 'margin':
        return this.margin(query);
      default:
        return this.mrr(query);
    }
  }

  async mrr(query: MetricQuery): Promise<MetricResult> {
    const q = validateQuery(query);
    assertFiltersSupported('mrr', q, this.supportedFilters);
    const m = await this.billing.subscriptionMetrics();
    return buildResult({
      metric: 'mrr',
      unit: 'cents',
      tier: 'live',
      rows: [{ day: q.to, value: m.mrrCents }],
      from: q.from,
      to: q.to,
      grain: q.grain,
    });
  }

  async arr(query: MetricQuery): Promise<MetricResult> {
    const q = validateQuery(query);
    assertFiltersSupported('arr', q, this.supportedFilters);
    const m = await this.billing.subscriptionMetrics();
    return buildResult({
      metric: 'arr',
      unit: 'cents',
      tier: 'live',
      rows: [{ day: q.to, value: m.arrCents }],
      from: q.from,
      to: q.to,
      grain: q.grain,
    });
  }

  async revenue(query: MetricQuery): Promise<MetricResult> {
    const q = validateQuery(query);
    assertFiltersSupported('revenue', q, this.supportedFilters);
    const by = q.filters?.country
      ? 'country'
      : q.filters?.plan
        ? 'plan'
        : undefined;
    const rep = await this.reports.report(q.from, q.to, by);
    const byDimension = rep.breakdown?.map((b) => ({
      key: b.key,
      value: b.netCents,
    }));
    return buildResult({
      metric: 'revenue',
      unit: 'cents',
      tier: 'live',
      rows: [{ day: q.to, value: rep.summary.netCents }],
      from: q.from,
      to: q.to,
      grain: q.grain,
      byDimension,
    });
  }

  async atRisk(query: MetricQuery): Promise<MetricResult> {
    const q = validateQuery(query);
    assertFiltersSupported('at_risk', q, this.supportedFilters);
    const o = await this.billing.outstanding();
    return buildResult({
      metric: 'at_risk',
      unit: 'cents',
      tier: 'live',
      rows: [{ day: q.to, value: o.amountCents }],
      from: q.from,
      to: q.to,
      grain: q.grain,
    });
  }

  async mrrTrend(query: MetricQuery): Promise<MetricResult> {
    const q = validateQuery(query);
    assertFiltersSupported('mrr_trend', q, this.supportedFilters);
    const dimKey = q.filters?.plan
      ? 'plan'
      : q.filters?.country
        ? 'country'
        : '';
    const rows = await this.src.queryMetricDaily('mrr', q.from, q.to, dimKey);
    return buildResult({
      metric: 'mrr_trend',
      unit: 'cents',
      tier: 'rollup',
      rows: rows.map((r) => ({ day: r.day, value: r.value })),
      from: q.from,
      to: q.to,
      grain: q.grain,
      slaMinutes: rollupStaleMinutes(this.config),
    });
  }

  async margin(query: MetricQuery): Promise<MetricResult> {
    const q = validateQuery(query);
    assertFiltersSupported('margin', q, this.supportedFilters);
    const rep = await this.reports.report(q.from, q.to);
    const [payout, ai] = await Promise.all([
      this.deps.payoutCents(q.from, q.to),
      this.deps.aiCostCents(q.from, q.to),
    ]);
    const value = rep.summary.netCents - payout - ai;
    return buildResult({
      metric: 'margin',
      unit: 'cents',
      tier: 'derived',
      rows: [{ day: q.to, value }],
      from: q.from,
      to: q.to,
      grain: q.grain,
    });
  }
}
