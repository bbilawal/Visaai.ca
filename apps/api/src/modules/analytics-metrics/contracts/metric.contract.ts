import type { SubPlan } from '../../subscriptions/subscription.constants';

export type Grain = 'day' | 'week' | 'month';
export type PlanTier = SubPlan;

export interface MetricFilters {
  country?: string;
  plan?: PlanTier;
  visa_type?: string;
  framework_id?: string;
  consultant_id?: string;
}

export interface MetricQuery {
  from: string; // ISO date inclusive
  to: string; // ISO date inclusive
  grain: Grain;
  filters?: MetricFilters;
  compareTo?: 'prev_period' | 'prev_year' | null;
}

export type MetricUnit = 'cents' | 'count' | 'ratio' | 'usd';

export interface MetricResult<TExtra = unknown> {
  metric: string;
  unit: MetricUnit;
  total: number;
  series: { bucket: string; value: number }[];
  byDimension?: { key: string; value: number }[];
  delta?: { baseline: number; pct: number } | null;
  meta: {
    computedAt: string;
    tier: 'live' | 'rollup' | 'derived';
    stale?: boolean;
  };
  extra?: TExtra;
}

export interface MetricService<
  P extends MetricQuery = MetricQuery,
  R = MetricResult,
> {
  readonly key: string;
  readonly supportedFilters: (keyof MetricFilters)[];
  compute(query: P): Promise<R>;
}
