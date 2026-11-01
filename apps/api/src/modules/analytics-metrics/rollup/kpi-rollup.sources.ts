import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../shared/supabase/supabase.service';
import type {
  KpiRollupReader,
  KpiRollupWriter,
  MetricDailyRow,
  FunnelDailyRow,
  IdentityLink,
} from './kpi-rollup.service';
import type {
  CohortReader,
  CohortRow,
  KpiCohortWriter,
} from './kpi-cohort.service';

/**
 * v1 stub source. The concrete Supabase-backed reader that scans event_stream /
 * subscriptions / commission history is a documented follow-up (see spec §13 —
 * source-wiring). Until it lands the rollup jobs run harmlessly and the kpi_*
 * tables stay empty, so rollup-tier metrics report meta.stale=true. No rework
 * needed when the real reader replaces this provider.
 */
@Injectable()
export class NoopKpiRollupReader implements KpiRollupReader, CohortReader {
  async churnEventsSince(): Promise<
    { subscriptionId: string; day: string; kind: 'voluntary' | 'involuntary' }[]
  > {
    return [];
  }
  async activeAtStart(): Promise<
    { day: string; dimVal: string; value: number }[]
  > {
    return [];
  }
  async identifiedSince(): Promise<IdentityLink[]> {
    return [];
  }
  async funnelCountsSince(): Promise<FunnelDailyRow[]> {
    return [];
  }
  async mrrSnapshot(): Promise<
    { day: string; dimVal: string; value: number }[]
  > {
    return [];
  }
  async commissionSplitsSince(): Promise<
    {
      day: string;
      consultantId: string;
      grossCents: number;
      payoutCents: number;
    }[]
  > {
    return [];
  }
  async subscriptionCohorts(): Promise<CohortRow[]> {
    return [];
  }
}

/** Production-ready sink: upserts rollup rows into the kpi_* tables (idempotent by PK). */
@Injectable()
export class SupabaseKpiWriter implements KpiRollupWriter, KpiCohortWriter {
  constructor(private readonly supabase: SupabaseService) {}

  async upsertMetricDaily(rows: MetricDailyRow[]): Promise<void> {
    if (rows.length === 0) return;
    const { error } = await this.supabase.admin.from('kpi_metric_daily').upsert(
      rows.map((r) => ({
        day: r.day,
        metric: r.metric,
        dim_key: r.dimKey,
        dim_val: r.dimVal,
        value_num: r.value,
      })),
      { onConflict: 'day,metric,dim_key,dim_val' },
    );
    if (error) throw error;
  }

  async upsertFunnelDaily(rows: FunnelDailyRow[]): Promise<void> {
    if (rows.length === 0) return;
    const { error } = await this.supabase.admin.from('kpi_funnel_daily').upsert(
      rows.map((r) => ({
        day: r.day,
        funnel: r.funnel,
        step: r.step,
        step_index: r.stepIndex,
        dim_key: r.dimKey,
        dim_val: r.dimVal,
        entered: r.entered,
        converted: r.converted,
      })),
      { onConflict: 'day,funnel,step,dim_key,dim_val' },
    );
    if (error) throw error;
  }

  async upsertIdentityLinks(links: IdentityLink[]): Promise<void> {
    if (links.length === 0) return;
    const { error } = await this.supabase.admin
      .from('analytics_identity_map')
      .upsert(
        links.map((l) => ({ anonymous_id: l.anonymousId, user_id: l.userId })),
        { onConflict: 'anonymous_id' },
      );
    if (error) throw error;
  }

  async upsertCohorts(rows: CohortRow[]): Promise<void> {
    if (rows.length === 0) return;
    const { error } = await this.supabase.admin
      .from('kpi_retention_cohort')
      .upsert(
        rows.map((r) => ({
          cohort_month: r.cohortMonth,
          period_index: r.periodIndex,
          dim_key: r.dimKey,
          dim_val: r.dimVal,
          cohort_size: r.cohortSize,
          retained: r.retained,
          retained_cents: r.retainedCents,
        })),
        { onConflict: 'cohort_month,period_index,dim_key,dim_val' },
      );
    if (error) throw error;
  }
}
