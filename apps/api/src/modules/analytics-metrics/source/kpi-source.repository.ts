export const KPI_SOURCE_REPOSITORY = Symbol('KPI_SOURCE_REPOSITORY');

export interface DailyValueRow {
  day: string;
  dimVal: string;
  value: number;
}
export interface FunnelStepRow {
  day: string;
  funnel: string;
  step: string;
  stepIndex: number;
  dimVal: string;
  entered: number;
  converted: number;
}
export interface DailyActiveRow {
  day: string;
  dau: number;
  wau: number;
  mau: number;
}
export interface RetentionCohortRow {
  cohortMonth: string;
  periodIndex: number;
  dimVal: string;
  cohortSize: number;
  retained: number;
  retainedCents: number;
}
export interface AiCostRow {
  day: string;
  costCents: number;
}

export interface IKpiSourceRepository {
  queryMetricDaily(
    metric: string,
    from: string,
    to: string,
    dimKey: string,
  ): Promise<DailyValueRow[]>;
  queryFunnelDaily(
    funnel: string,
    from: string,
    to: string,
    dimKey: string,
  ): Promise<FunnelStepRow[]>;
  queryDailyActive(from: string, to: string): Promise<DailyActiveRow[]>;
  queryRetentionCohort(
    from: string,
    to: string,
    dimKey: string,
  ): Promise<RetentionCohortRow[]>;
  queryAiCostPerApplication(from: string, to: string): Promise<AiCostRow[]>;
}
