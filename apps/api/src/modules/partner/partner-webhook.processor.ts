import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PARTNER_WEBHOOK_QUEUE } from '../shared/queue/queue.constants';
import { PartnerWebhookService } from './partner-webhook.service';

const BATCH = 50;

/**
 * Drains due webhook deliveries on a repeatable tick.
 *
 * A tick rather than a job-per-delivery: retries with backoff need a
 * `next_attempt_at` in the database anyway (so they survive a restart and are
 * visible to the partner in the delivery log), and once that exists, BullMQ's
 * own delayed jobs would be a second, disagreeing source of truth about when
 * the next attempt is due.
 */
@Injectable()
@Processor(PARTNER_WEBHOOK_QUEUE)
export class PartnerWebhookProcessor extends WorkerHost {
  private readonly log = new Logger(PartnerWebhookProcessor.name);

  constructor(private readonly webhooks: PartnerWebhookService) {
    super();
  }

  async process(): Promise<void> {
    const result = await this.webhooks.drainOnce(BATCH);
    if (result.attempted > 0) {
      this.log.log(
        `webhook drain — ${result.attempted} attempted / ${result.delivered} delivered / ${result.dead} dead`,
      );
    }
  }
}

/** Fixed jobId so repeated boots do not stack duplicate schedules. */
@Injectable()
export class PartnerWebhookScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(PARTNER_WEBHOOK_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      'drain',
      {},
      {
        repeat: { every: 10_000 },
        jobId: 'partner-webhook-drain',
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
  }
}
