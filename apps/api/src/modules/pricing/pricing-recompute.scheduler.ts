import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PRICING_RECOMPUTE_QUEUE } from '../shared/queue/queue.constants';

@Injectable()
export class PricingRecomputeScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(PRICING_RECOMPUTE_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    // Nightly at 03:00 UTC. Fixed jobId so repeated boots don't duplicate the schedule.
    await this.queue.add(
      'nightly-recompute',
      {},
      {
        repeat: { pattern: '0 3 * * *' },
        jobId: 'pricing-recompute-nightly',
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
  }
}
