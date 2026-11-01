import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { REMINDER_QUEUE } from '../shared/queue/queue.constants';

@Injectable()
export class RemindersScheduler implements OnModuleInit {
  constructor(@InjectQueue(REMINDER_QUEUE) private readonly queue: Queue) {}

  async onModuleInit() {
    // Daily at 14:00 UTC. Fixed jobId so repeated boots don't duplicate the schedule.
    await this.queue.add(
      'daily-scan',
      {},
      {
        repeat: { pattern: '0 14 * * *' },
        jobId: 'reminders-daily',
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
  }
}
