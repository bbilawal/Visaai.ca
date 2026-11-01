import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PAYOUTS_SWEEP_QUEUE } from '../shared/queue/queue.constants';

@Injectable()
export class PayoutsSweepScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(PAYOUTS_SWEEP_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    // Daily at 04:00 UTC. Fixed jobId so repeated boots don't duplicate the schedule.
    await this.queue.add(
      'daily-sweep',
      {},
      {
        repeat: { pattern: '0 4 * * *' },
        jobId: 'payouts-sweep-daily',
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
  }
}
