import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { BroadcastAudience } from '@visaai/types';
import { SupabaseService } from '../../shared/supabase/supabase.service';
import { BROADCAST_QUEUE } from '../../shared/queue/queue.constants';
import { NotificationsService } from '../notifications.service';
import {
  NOTIFICATION_BROADCAST_REPOSITORY,
  type INotificationBroadcastRepository,
} from './notification-broadcast.repository';
import {
  platformAdminIds,
  resolveAdminEmails,
  type AdminDirectory,
} from '../../admin/admin-recipients';

const PAGE = 500;

/**
 * Fans a broadcast out to its audience by calling NotificationsService.emit()
 * per recipient — so every per-user guarantee (preference gating, quiet-hours
 * delay, delivery tracking, DLQ) applies. Best-effort per user (emit swallows);
 * idempotent on retry (emit dedupes per broadcast+user via entityIdOf).
 */
@Processor(BROADCAST_QUEUE)
export class BroadcastProcessor extends WorkerHost {
  private readonly log = new Logger(BroadcastProcessor.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly notifications: NotificationsService,
    @Inject(NOTIFICATION_BROADCAST_REPOSITORY)
    private readonly repo: INotificationBroadcastRepository,
  ) {
    super();
  }

  async process(job: Job<{ broadcastId: string }>): Promise<void> {
    const admin = this.supabase.admin;
    const b = await this.repo.getById(admin, job.data.broadcastId);
    if (!b || b.status !== 'sending') return; // already processed / missing

    try {
      let count = 0;
      for await (const userId of this.audienceIds(b.audience)) {
        await this.notifications.emit({
          type: 'system.broadcast',
          userId,
          broadcastId: b.id,
          data: {
            title: b.title,
            body: b.body,
            link: b.link ?? '/',
            category: b.category,
          },
        });
        count += 1;
      }
      await this.repo.markSent(admin, b.id, count);
      this.log.log(`broadcast ${b.id}: emitted to ${count} recipients`);
    } catch (err) {
      // Only mark 'failed' (terminal) once Bull's retries are exhausted. On a
      // non-final attempt we leave status='sending' + rethrow, so the retried
      // job resumes the fan-out (the `status !== 'sending'` guard above would
      // otherwise no-op it) — emit's per-broadcast dedupe skips already-sent
      // recipients, so the resume is idempotent.
      const maxAttempts = job.opts?.attempts ?? 1;
      if (job.attemptsMade >= maxAttempts) {
        await this.repo.markFailed(admin, b.id).catch(() => undefined);
      }
      this.log.error(
        `broadcast ${b.id} fan-out error (attempt ${job.attemptsMade}/${maxAttempts}): ${(err as Error).message}`,
      );
      throw err;
    }
  }

  /** Resolve the audience to user ids, paginated (bounded memory). */
  private async *audienceIds(
    audience: BroadcastAudience,
  ): AsyncGenerator<string> {
    const admin = this.supabase.admin;
    if (audience.kind === 'users') {
      for (const id of audience.userIds) yield id;
      return;
    }
    if (audience.kind === 'all') {
      for (let page = 0; ; page++) {
        const { data, error } = await admin
          .from('users')
          .select('id')
          .neq('status', 'deleted')
          .range(page * PAGE, page * PAGE + PAGE - 1);
        if (error) throw new Error(error.message);
        const rows = (data ?? []) as { id: string }[];
        for (const r of rows) yield r.id;
        if (rows.length < PAGE) return;
      }
    }
    // role: page through the GoTrue admin API. 'admin' resolves the way the
    // login gate does — app_metadata.role OR the ADMIN_EMAILS allow-list — so a
    // broadcast to admins reaches the people who can actually sign in as one
    // (OPS-001). Other roles have no allow-list and match on metadata alone.
    if (audience.role === 'admin') {
      yield* platformAdminIds(
        admin as unknown as AdminDirectory,
        resolveAdminEmails(),
      );
      return;
    }
    for (let page = 1; ; page++) {
      const { data, error } = await admin.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (error) throw error;
      for (const u of data.users) {
        if (
          (u.app_metadata as { role?: string } | undefined)?.role ===
          audience.role
        ) {
          yield u.id;
        }
      }
      if (data.users.length < 200) return;
    }
  }
}
