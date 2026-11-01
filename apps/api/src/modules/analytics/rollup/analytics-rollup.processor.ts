import { Injectable } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ANALYTICS_ROLLUP_QUEUE } from '../../shared/queue/queue.constants';
import { AnalyticsRollupService } from './analytics-rollup.service';

/** Runs the reference rollup on each repeatable tick (see AnalyticsRollupScheduler). */
@Injectable()
@Processor(ANALYTICS_ROLLUP_QUEUE)
export class AnalyticsRollupProcessor extends WorkerHost {
  constructor(private readonly rollup: AnalyticsRollupService) {
    super();
  }

  async process(): Promise<void> {
    await this.rollup.recompute();
  }
}
