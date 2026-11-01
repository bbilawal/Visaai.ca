import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ANALYTICS_ROLLUP_QUEUE } from '../../shared/queue/queue.constants';

/**
 * Registers the repeatable rollup-recompute tick. Fixed jobId so repeated
 * boots do not duplicate the schedule. Every 5 minutes keeps
 * `analytics_event_daily` close to real time without coupling ingest writes
 * to the rollup path.
 */
@Injectable()
export class AnalyticsRollupScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(ANALYTICS_ROLLUP_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      'recompute',
      {},
      {
        repeat: { every: 300_000 }, // 5 min
        jobId: 'analytics-rollup-recompute',
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
  }
}
