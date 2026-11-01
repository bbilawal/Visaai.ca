import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { NOTIFICATION_DLQ_ALERT_QUEUE } from '../../shared/queue/queue.constants';

/**
 * Registers the hourly dead-letter alert check. Fixed jobId so repeated boots
 * do not duplicate the schedule.
 */
@Injectable()
export class DlqAlertScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(NOTIFICATION_DLQ_ALERT_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    await this.queue.add(
      'dlq-check',
      {},
      {
        repeat: { pattern: '0 * * * *' }, // top of every hour
        jobId: 'notification-dlq-alert-hourly',
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
  }
}
