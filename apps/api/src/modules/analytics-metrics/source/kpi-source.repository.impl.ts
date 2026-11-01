import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../shared/supabase/supabase.service';
import type {
  IKpiSourceRepository,
  DailyValueRow,
  FunnelStepRow,
  DailyActiveRow,
  RetentionCohortRow,
  AiCostRow,
} from './kpi-source.repository';

@Injectable()
export class SupabaseKpiSourceRepository implements IKpiSourceRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async queryMetricDaily(
    metric: string,
    from: string,
    to: string,
    dimKey: string,
  ): Promise<DailyValueRow[]> {
    const { data, error } = await this.supabase.admin
      .from('kpi_metric_daily')
      .select('day, dim_val, value_num')
      .eq('metric', metric)
      .eq('dim_key', dimKey)
      .gte('day', from)
      .lte('day', to)
      .order('day', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      day: r.day,
      dimVal: r.dim_val,
      value: Number(r.value_num),
    }));
  }

  async queryFunnelDaily(
    funnel: string,
    from: string,
    to: string,
    dimKey: string,
  ): Promise<FunnelStepRow[]> {
    const { data, error } = await this.supabase.admin
      .from('kpi_funnel_daily')
      .select('day, funnel, step, step_index, dim_val, entered, converted')
      .eq('funnel', funnel)
      .eq('dim_key', dimKey)
      .gte('day', from)
      .lte('day', to)
      .order('day', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      day: r.day,
      funnel: r.funnel,
      step: r.step,
      stepIndex: r.step_index,
      dimVal: r.dim_val,
      entered: Number(r.entered),
      converted: Number(r.converted),
    }));
  }

  async queryDailyActive(from: string, to: string): Promise<DailyActiveRow[]> {
    const { data, error } = await this.supabase.admin
      .from('analytics_daily_active')
      .select('day, dau, wau, mau')
      .gte('day', from)
      .lte('day', to)
      .order('day', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      day: r.day,
      dau: Number(r.dau),
      wau: Number(r.wau),
      mau: Number(r.mau),
    }));
  }

  async queryRetentionCohort(
    from: string,
    to: string,
    dimKey: string,
  ): Promise<RetentionCohortRow[]> {
    const { data, error } = await this.supabase.admin
      .from('kpi_retention_cohort')
      .select(
        'cohort_month, period_index, dim_val, cohort_size, retained, retained_cents',
      )
      .eq('dim_key', dimKey)
      .gte('cohort_month', from)
      .lte('cohort_month', to)
      .order('cohort_month', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      cohortMonth: r.cohort_month,
      periodIndex: r.period_index,
      dimVal: r.dim_val,
      cohortSize: Number(r.cohort_size),
      retained: Number(r.retained),
      retainedCents: Number(r.retained_cents),
    }));
  }

  async queryAiCostPerApplication(
    from: string,
    to: string,
  ): Promise<AiCostRow[]> {
    const { data, error } = await this.supabase.admin
      .from('ai_cost_per_application')
      .select('day, cost_cents')
      .gte('day', from)
      .lte('day', to)
      .order('day', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      day: r.day,
      costCents: Number(r.cost_cents),
    }));
  }
}
