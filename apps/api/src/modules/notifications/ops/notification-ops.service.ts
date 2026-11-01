import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type {
  FailedDeliveryPage,
  FailedDeliveryRow,
  NotificationOpsMetrics,
  NotificationOpsRange,
} from '@visaai/types';
import { SupabaseService } from '../../shared/supabase/supabase.service';
import { SYSTEM_NOTIFICATION_QUEUE } from '../../shared/queue/queue.constants';
import { NotificationEventBus } from '../notification-event-bus';
import { shapeOpsMetrics } from './ops-metrics';
import {
  platformAdminIds,
  resolveAdminEmails,
  type AdminDirectory,
} from '../../admin/admin-recipients';

const DLQ_DEFAULT_THRESHOLD = 25;

const DAYS: Record<NotificationOpsRange, number> = {
  '24h': 1,
  '7d': 7,
  '30d': 30,
};
const STATUSES = ['queued', 'sent', 'failed', 'skipped', 'dead'] as const;
const CHANNELS = ['in_app', 'email', 'web_push', 'sms'] as const;
const EVENTS = [
  'consultant.assigned',
  'payment.received',
  'ai.assessment_complete',
  'application.status_changed',
] as const;

@Injectable()
export class NotificationOpsService {
  constructor(
    private readonly supabase: SupabaseService,
    @InjectQueue(SYSTEM_NOTIFICATION_QUEUE) private readonly queue: Queue,
    private readonly bus: NotificationEventBus,
  ) {}

  /**
   * Alert admins when dead-letter deliveries grow past a threshold. Counts
   * `dead` deliveries in the last 24h; if over `NOTIFICATION_DLQ_ALERT_THRESHOLD`
   * (default 25) it dogfoods our own channel — emits a `system.broadcast` to
   * every admin. The broadcastId is bucketed to the hour so emit()'s dedupe
   * gate delivers at most one alert per admin per hour. Runs on a schedule.
   */
  async checkDlqThreshold(
    now = new Date(),
  ): Promise<{ alerted: boolean; dead: number }> {
    // A misconfigured value must not disable the alarm. `Number('twenty')` is
    // NaN, and `dead > NaN` is false for every possible dead count — so a typo
    // in this variable silently turned the dead-letter alert off completely,
    // which is the one failure mode a watchdog cannot afford.
    const raw = Number(
      process.env.NOTIFICATION_DLQ_ALERT_THRESHOLD ?? DLQ_DEFAULT_THRESHOLD,
    );
    const threshold =
      Number.isFinite(raw) && raw > 0 ? raw : DLQ_DEFAULT_THRESHOLD;
    const since = new Date(now.getTime() - 86_400_000).toISOString();
    const { count, error } = await this.supabase.admin
      .from('notification_deliveries')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'dead')
      .gte('created_at', since);
    if (error) throw error;
    const dead = count ?? 0;
    if (dead <= threshold) return { alerted: false, dead };

    const broadcastId = `dlq-alert:${now.toISOString().slice(0, 13)}`; // yyyy-mm-ddThh
    for await (const adminId of this.adminIds()) {
      this.bus.emit({
        type: 'system.broadcast',
        userId: adminId,
        broadcastId,
        data: {
          title: 'Notification delivery failures',
          body: `${dead} notification deliveries are dead in the last 24h (threshold ${threshold}). Review the ops dashboard.`,
          link: '/notification-ops',
          category: 'system',
        },
      });
    }
    return { alerted: true, dead };
  }

  /** Admin user ids — the same admins the login gate recognises (OPS-001). */
  private adminIds(): AsyncGenerator<string> {
    return platformAdminIds(
      this.supabase.admin as unknown as AdminDirectory,
      resolveAdminEmails(),
    );
  }

  static coerceRange(input: unknown): NotificationOpsRange {
    return input === '24h' || input === '30d' ? input : '7d';
  }

  async metrics(range: NotificationOpsRange): Promise<NotificationOpsMetrics> {
    const db = this.supabase.admin;
    const sinceIso = new Date(
      Date.now() - DAYS[range] * 86_400_000,
    ).toISOString();
    const count = async (build: (q: any) => any): Promise<number> => {
      const { count: c, error } = await build(
        db
          .from('notification_deliveries')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', sinceIso),
      );
      if (error) throw error;
      return c ?? 0;
    };

    const statusCounts: Record<string, number> = {};
    for (const s of STATUSES)
      statusCounts[s] = await count((q) => q.eq('status', s));
    const channelCounts: Record<string, number> = {};
    for (const c of CHANNELS)
      channelCounts[c] = await count((q) => q.eq('channel', c));
    const eventCounts: Record<string, number> = {};
    for (const e of EVENTS)
      eventCounts[e] = await count((q) => q.eq('event_type', e));

    // Queue counts come from Redis; the DB-backed delivery metrics must still
    // render if the queue is unreachable, so degrade to zeros rather than 500.
    let queue = { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
    try {
      const jc = await this.queue.getJobCounts(
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed',
      );
      queue = {
        waiting: jc.waiting ?? 0,
        active: jc.active ?? 0,
        completed: jc.completed ?? 0,
        failed: jc.failed ?? 0,
        delayed: jc.delayed ?? 0,
      };
    } catch {
      /* queue unreachable — delivery metrics still render with zeroed queue */
    }

    return shapeOpsMetrics({
      range,
      statusCounts,
      channelCounts,
      eventCounts,
      queue,
    });
  }

  async failed(cursor: string | null, limit = 25): Promise<FailedDeliveryPage> {
    const db = this.supabase.admin;
    const lim = Math.min(Math.max(limit, 1), 100);
    let q = db
      .from('notification_deliveries')
      .select(
        'id, event_type, channel, status, attempts, error, user_id, created_at',
        {
          count: 'exact',
        },
      )
      .in('status', ['failed', 'dead'])
      .order('created_at', { ascending: false });
    if (cursor) q = q.lt('created_at', cursor);
    const { data, count, error } = await q.limit(lim + 1);
    if (error) throw error;

    const raw = (data ?? []) as {
      id: string;
      event_type: string;
      channel: string;
      status: string;
      attempts: number;
      error: string | null;
      user_id: string;
      created_at: string;
    }[];
    const hasMore = raw.length > lim;
    const page = hasMore ? raw.slice(0, lim) : raw;
    const rows: FailedDeliveryRow[] = page.map((r) => ({
      id: r.id,
      eventType: r.event_type,
      channel: r.channel,
      status: r.status,
      attempts: r.attempts,
      error: r.error,
      userId: r.user_id,
      createdAt: r.created_at,
    }));
    return {
      rows,
      total: count ?? 0,
      nextCursor: hasMore ? page[page.length - 1].created_at : null,
    };
  }

  async retry(deliveryId: string): Promise<{ requeued: true }> {
    const db = this.supabase.admin;
    const { data: del, error } = await db
      .from('notification_deliveries')
      .select('id, notification_id, user_id, channel, status')
      .eq('id', deliveryId)
      .maybeSingle();
    if (error) throw error;
    if (!del) throw new NotFoundException('delivery not found');
    const d = del;
    if (d.channel === 'in_app') {
      throw new BadRequestException(
        'in_app deliveries have no channel job to retry',
      );
    }
    if (d.status !== 'failed' && d.status !== 'dead') {
      throw new BadRequestException(
        'only failed or dead deliveries can be retried',
      );
    }

    let title = '';
    let body = '';
    let link = '';
    if (d.notification_id) {
      const { data: notif } = await db
        .from('notifications')
        .select('title, body, link')
        .eq('id', d.notification_id)
        .maybeSingle();
      const n = notif as {
        title?: string;
        body?: string;
        link?: string;
      } | null;
      title = n?.title ?? '';
      body = n?.body ?? '';
      link = n?.link ?? '';
    }

    await this.queue.add(
      d.channel,
      { deliveryId: d.id, userId: d.user_id, title, body, link },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
    const { error: upErr } = await db
      .from('notification_deliveries')
      .update({
        status: 'queued',
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', d.id);
    if (upErr) throw upErr;
    return { requeued: true };
  }
}
