import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DUNNING_QUEUE } from '../shared/queue/queue.constants';

@Injectable()
export class DunningScheduler implements OnModuleInit {
  constructor(@InjectQueue(DUNNING_QUEUE) private readonly queue: Queue) {}

  async onModuleInit() {
    // Daily at 06:00 UTC. Fixed jobId prevents duplicate schedules across boots.
    await this.queue.add(
      'daily-dunning',
      {},
      {
        repeat: { pattern: '0 6 * * *' },
        jobId: 'dunning-daily',
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
  }
}
