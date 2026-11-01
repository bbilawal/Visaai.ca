import { Inject, Injectable } from '@nestjs/common';

export interface CohortRow {
  cohortMonth: string;
  periodIndex: number;
  dimKey: string;
  dimVal: string;
  cohortSize: number;
  retained: number;
  retainedCents: number;
}
export interface CohortReader {
  subscriptionCohorts(): Promise<CohortRow[]>;
}
export interface KpiCohortWriter {
  upsertCohorts(rows: CohortRow[]): Promise<void>;
}

export const KPI_COHORT_READER = Symbol('KPI_COHORT_READER');
export const KPI_COHORT_WRITER = Symbol('KPI_COHORT_WRITER');

@Injectable()
export class KpiCohortService {
  constructor(
    @Inject(KPI_COHORT_READER) private readonly reader: CohortReader,
    @Inject(KPI_COHORT_WRITER) private readonly writer: KpiCohortWriter,
  ) {}

  async recompute(): Promise<number> {
    const rows = await this.reader.subscriptionCohorts();
    await this.writer.upsertCohorts(rows);
    return rows.length;
  }
}
