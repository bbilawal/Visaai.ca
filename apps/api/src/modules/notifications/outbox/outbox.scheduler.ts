import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { NOTIFICATION_OUTBOX_QUEUE } from '../../shared/queue/queue.constants';

/**
 * Registers the repeatable outbox-drain tick. Fixed jobId so repeated boots do
 * not duplicate the schedule. Every 10s keeps status-change notifications
 * near-real-time without a per-write hook in application code.
 */
@Injectable()
export class OutboxScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(NOTIFICATION_OUTBOX_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    await this.queue.add(
      'drain',
      {},
      {
        repeat: { every: 10_000 },
        jobId: 'notification-outbox-drain',
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
  }
}
