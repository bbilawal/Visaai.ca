import { Injectable } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { KPI_COHORT_QUEUE } from '../../shared/queue/queue.constants';
import { KpiCohortService } from './kpi-cohort.service';

/** Runs the cohort recompute on each repeatable tick (see KpiCohortScheduler). */
@Injectable()
@Processor(KPI_COHORT_QUEUE)
export class KpiCohortProcessor extends WorkerHost {
  constructor(private readonly cohort: KpiCohortService) {
    super();
  }

  async process(): Promise<void> {
    await this.cohort.recompute();
  }
}
