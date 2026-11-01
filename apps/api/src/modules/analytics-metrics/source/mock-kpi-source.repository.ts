import type {
  IKpiSourceRepository,
  DailyValueRow,
  FunnelStepRow,
  DailyActiveRow,
  RetentionCohortRow,
  AiCostRow,
} from './kpi-source.repository';

interface MetricSeed {
  metric: string;
  day: string;
  dimKey: string;
  dimVal: string;
  value: number;
}
interface FunnelSeed extends FunnelStepRow {
  dimKey: string;
}
interface CohortSeed extends RetentionCohortRow {
  dimKey: string;
}

export class MockKpiSourceRepository implements IKpiSourceRepository {
  constructor(
    private readonly seed: {
      metricDaily?: MetricSeed[];
      funnelDaily?: FunnelSeed[];
      dailyActive?: DailyActiveRow[];
      retentionCohort?: CohortSeed[];
      aiCost?: AiCostRow[];
    },
  ) {}

  async queryMetricDaily(
    metric: string,
    from: string,
    to: string,
    dimKey: string,
  ): Promise<DailyValueRow[]> {
    return (this.seed.metricDaily ?? [])
      .filter(
        (r) =>
          r.metric === metric &&
          r.dimKey === dimKey &&
          r.day >= from &&
          r.day <= to,
      )
      .map((r) => ({ day: r.day, dimVal: r.dimVal, value: r.value }));
  }

  async queryFunnelDaily(
    funnel: string,
    from: string,
    to: string,
    dimKey: string,
  ): Promise<FunnelStepRow[]> {
    return (this.seed.funnelDaily ?? [])
      .filter(
        (r) =>
          r.funnel === funnel &&
          r.dimKey === dimKey &&
          r.day >= from &&
          r.day <= to,
      )
      .map(
        ({ day, funnel: f, step, stepIndex, dimVal, entered, converted }) => ({
          day,
          funnel: f,
          step,
          stepIndex,
          dimVal,
          entered,
          converted,
        }),
      );
  }

  async queryDailyActive(from: string, to: string): Promise<DailyActiveRow[]> {
    return (this.seed.dailyActive ?? []).filter(
      (r) => r.day >= from && r.day <= to,
    );
  }

  async queryRetentionCohort(
    from: string,
    to: string,
    dimKey: string,
  ): Promise<RetentionCohortRow[]> {
    return (this.seed.retentionCohort ?? [])
      .filter(
        (r) =>
          r.dimKey === dimKey && r.cohortMonth >= from && r.cohortMonth <= to,
      )
      .map(
        ({
          cohortMonth,
          periodIndex,
          dimVal,
          cohortSize,
          retained,
          retainedCents,
        }) => ({
          cohortMonth,
          periodIndex,
          dimVal,
          cohortSize,
          retained,
          retainedCents,
        }),
      );
  }

  async queryAiCostPerApplication(
    from: string,
    to: string,
  ): Promise<AiCostRow[]> {
    return (this.seed.aiCost ?? []).filter((r) => r.day >= from && r.day <= to);
  }
}
