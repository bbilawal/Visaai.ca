import { Injectable } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ANALYTICS_RETENTION_QUEUE } from '../../shared/queue/queue.constants';
import { AnalyticsRetentionService } from './analytics-retention.service';

/**
 * Runs the retention prune on each repeatable tick (see AnalyticsRetentionScheduler).
 * Rollups are NOT pruned — only raw events via pruneBefore.
 */
@Injectable()
@Processor(ANALYTICS_RETENTION_QUEUE)
export class AnalyticsRetentionProcessor extends WorkerHost {
  constructor(private readonly retention: AnalyticsRetentionService) {
    super();
  }

  async process(): Promise<void> {
    await this.retention.prune();
  }
}
