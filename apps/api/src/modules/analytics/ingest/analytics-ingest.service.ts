import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { AnalyticsEventBus } from '../analytics-event-bus';
import { ANALYTICS_INGEST_QUEUE } from '../../shared/queue/queue.constants';
import type { Env } from '../../../config/configuration';
import type { AnalyticsEvent } from '../events/catalog';

/**
 * Coalescer: subscribes to the in-proc AnalyticsEventBus and enqueues each
 * emitted event as a BullMQ batch-job (chunked to ANALYTICS_INGEST_BATCH —
 * one event per emit today, but ingest() accepts arrays so future batched
 * producers/backfills reuse the same chunking path).
 *
 * Subscriber-side error containment: AnalyticsEventBus.emitSafe only guards
 * the producer. An uncaught throw or unhandled promise rejection inside the
 * `next` callback passed to events$.subscribe would be routed by RxJS to
 * reportUnhandledError and crash the process (this exact failure class was
 * already fixed once in Task 4). The callback below is synchronous and
 * non-throwing, and the async ingest() promise's rejection is always
 * explicitly caught — never a floating/void-ed promise.
 */
@Injectable()
export class AnalyticsIngestService implements OnModuleInit {
  private readonly log = new Logger(AnalyticsIngestService.name);

  constructor(
    private readonly bus: AnalyticsEventBus,
    @InjectQueue(ANALYTICS_INGEST_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService<Env>,
  ) {}

  onModuleInit(): void {
    this.bus.events$.subscribe((e) => {
      this.ingest([e]).catch((err) =>
        this.log.warn(
          `analytics ingest enqueue failed: ${(err as Error).message}`,
        ),
      );
    });
  }

  async ingest(events: AnalyticsEvent[]): Promise<void> {
    if (events.length === 0) return;
    const size =
      this.config.get('ANALYTICS_INGEST_BATCH', { infer: true }) ?? 100;
    for (let i = 0; i < events.length; i += size) {
      const chunk = events.slice(i, i + size);
      await this.queue.add(
        'batch',
        { events: chunk },
        {
          removeOnComplete: true,
          removeOnFail: 100,
          attempts: 5,
          backoff: { type: 'exponential', delay: 1000 },
        },
      );
    }
  }
}
