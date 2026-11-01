import { Inject, Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { SupabaseService } from '../../shared/supabase/supabase.service';
import { NOTIFICATION_OUTBOX_QUEUE } from '../../shared/queue/queue.constants';
import { NotificationEventBus } from '../notification-event-bus';
import type { NotificationEvent } from '../events/catalog';
import {
  OUTBOX_REPOSITORY,
  type IOutboxRepository,
  type OutboxRow,
} from './outbox.repository';

const BATCH = 50;
const PRUNE_AFTER_DAYS = 30;

/**
 * Drains the notification outbox: claims unprocessed rows (skip-locked),
 * republishes each as a NotificationEvent onto the NotificationEventBus (which
 * NotificationsService.emit() consumes — inheriting prefs/quiet-hours/dedupe),
 * and marks them processed. Idempotent: a row is claimed once and marked
 * processed; emit()'s own dedupe (entityIdOf includes status) is the second
 * line of defense if a row is ever re-delivered.
 *
 * Runs on a repeatable BullMQ tick (see OutboxScheduler).
 */
@Injectable()
@Processor(NOTIFICATION_OUTBOX_QUEUE)
export class OutboxProcessor extends WorkerHost {
  private readonly log = new Logger(OutboxProcessor.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly bus: NotificationEventBus,
    @Inject(OUTBOX_REPOSITORY) private readonly repo: IOutboxRepository,
  ) {
    super();
  }

  async process(): Promise<void> {
    const { processed, failed } = await this.drainOnce();
    if (processed || failed) {
      this.log.log(`outbox drain — ${processed} processed / ${failed} failed`);
    }
  }

  /** Claim and dispatch one batch. Exposed for unit testing. */
  async drainOnce(): Promise<{ processed: number; failed: number }> {
    const admin = this.supabase.admin;
    const rows = await this.repo.claimBatch(admin, BATCH);

    let processed = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        this.bus.emit(this.toEvent(row));
        await this.repo.markProcessed(admin, row.id);
        processed += 1;
      } catch (err) {
        await this.repo
          .markFailed(admin, row.id, (err as Error).message)
          .catch(() => undefined);
        this.log.error(
          `outbox row ${row.id} failed: ${(err as Error).message}`,
        );
        failed += 1;
      }
    }

    await this.repo
      .pruneProcessed(admin, PRUNE_AFTER_DAYS)
      .catch(() => undefined);
    return { processed, failed };
  }

  /** Rebuild the typed NotificationEvent from a stored outbox row. */
  private toEvent(row: OutboxRow): NotificationEvent {
    const p = row.payload;
    if (row.event_type === 'application.status_changed') {
      const data = (p.data ?? {}) as { status?: string };
      return {
        type: 'application.status_changed',
        userId: String(p.userId),
        applicationId: String(p.applicationId),
        data: { status: String(data.status ?? '') },
      };
    }
    throw new Error(`unknown outbox event_type: ${row.event_type}`);
  }
}
