import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RECONCILE_QUEUE } from '../shared/queue/queue.constants';

@Injectable()
export class ReconciliationScheduler implements OnModuleInit {
  constructor(@InjectQueue(RECONCILE_QUEUE) private readonly queue: Queue) {}

  async onModuleInit() {
    // Daily at 05:00 UTC (after the 04:00 payouts sweep). Fixed jobId so
    // repeated boots don't duplicate the schedule.
    await this.queue.add(
      'daily-reconcile',
      {},
      {
        repeat: { pattern: '0 5 * * *' },
        jobId: 'reconciliation-daily',
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
  }
}
