import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ANALYTICS_RETENTION_QUEUE } from '../../shared/queue/queue.constants';

/**
 * Registers the repeatable retention prune tick. Fixed jobId so repeated
 * boots do not duplicate the schedule. Every 86_400_000ms (1 day) prunes
 * raw events older than the configured window.
 */
@Injectable()
export class AnalyticsRetentionScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(ANALYTICS_RETENTION_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      'prune',
      {},
      {
        repeat: { every: 86_400_000 }, // daily
        jobId: 'analytics-retention-prune',
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
  }
}
