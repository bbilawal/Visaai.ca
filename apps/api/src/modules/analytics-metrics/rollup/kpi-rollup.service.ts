import { Inject, Injectable } from '@nestjs/common';
import { dedupeChurn } from '../engine/churn.dedup';

export interface MetricDailyRow {
  metric: string;
  day: string;
  dimKey: string;
  dimVal: string;
  value: number;
}
export interface FunnelDailyRow {
  funnel: string;
  step: string;
  stepIndex: number;
  day: string;
  dimKey: string;
  dimVal: string;
  entered: number;
  converted: number;
}
export interface IdentityLink {
  anonymousId: string;
  userId: string;
}

export interface KpiRollupReader {
  churnEventsSince(
    days: number,
  ): Promise<
    { subscriptionId: string; day: string; kind: 'voluntary' | 'involuntary' }[]
  >;
  activeAtStart(
    days: number,
  ): Promise<{ day: string; dimVal: string; value: number }[]>;
  identifiedSince(days: number): Promise<IdentityLink[]>;
  funnelCountsSince(days: number): Promise<FunnelDailyRow[]>;
  mrrSnapshot(
    days: number,
  ): Promise<{ day: string; dimVal: string; value: number }[]>;
  commissionSplitsSince(days: number): Promise<
    {
      day: string;
      consultantId: string;
      grossCents: number;
      payoutCents: number;
    }[]
  >;
}
export interface KpiRollupWriter {
  upsertMetricDaily(rows: MetricDailyRow[]): Promise<void>;
  upsertFunnelDaily(rows: FunnelDailyRow[]): Promise<void>;
  upsertIdentityLinks(links: IdentityLink[]): Promise<void>;
}

export const KPI_ROLLUP_READER = Symbol('KPI_ROLLUP_READER');
export const KPI_ROLLUP_WRITER = Symbol('KPI_ROLLUP_WRITER');

@Injectable()
export class KpiRollupService {
  constructor(
    @Inject(KPI_ROLLUP_READER) private readonly reader: KpiRollupReader,
    @Inject(KPI_ROLLUP_WRITER) private readonly writer: KpiRollupWriter,
  ) {}

  async recompute(lookbackDays: number): Promise<{
    metricRows: number;
    funnelRows: number;
    identityLinks: number;
  }> {
    const [churn, active, identified, funnels, mrr, splits] = await Promise.all(
      [
        this.reader.churnEventsSince(lookbackDays),
        this.reader.activeAtStart(lookbackDays),
        this.reader.identifiedSince(lookbackDays),
        this.reader.funnelCountsSince(lookbackDays),
        this.reader.mrrSnapshot(lookbackDays),
        this.reader.commissionSplitsSince(lookbackDays),
      ],
    );

    const metricRows: MetricDailyRow[] = [];
    for (const e of dedupeChurn(churn)) {
      metricRows.push({
        metric: 'churn_total',
        day: e.day,
        dimKey: '',
        dimVal: '',
        value: 1,
      });
    }
    for (const a of active) {
      metricRows.push({
        metric: 'active_start',
        day: a.day,
        dimKey: '',
        dimVal: a.dimVal,
        value: a.value,
      });
    }
    for (const m of mrr) {
      metricRows.push({
        metric: 'mrr',
        day: m.day,
        dimKey: '',
        dimVal: m.dimVal,
        value: m.value,
      });
    }
    for (const s of splits) {
      metricRows.push({
        metric: 'consultant_gross',
        day: s.day,
        dimKey: '',
        dimVal: '',
        value: s.grossCents,
      });
      metricRows.push({
        metric: 'consultant_payout',
        day: s.day,
        dimKey: '',
        dimVal: '',
        value: s.payoutCents,
      });
      metricRows.push({
        metric: 'consultant_payout',
        day: s.day,
        dimKey: 'consultant_id',
        dimVal: s.consultantId,
        value: s.payoutCents,
      });
    }

    await this.writer.upsertMetricDaily(metricRows);
    await this.writer.upsertFunnelDaily(funnels);
    await this.writer.upsertIdentityLinks(identified);
    return {
      metricRows: metricRows.length,
      funnelRows: funnels.length,
      identityLinks: identified.length,
    };
  }
}
