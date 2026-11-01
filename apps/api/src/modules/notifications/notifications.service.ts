import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { NotificationEventBus } from './notification-event-bus';
import { SupabaseService } from '../shared/supabase/supabase.service';
import {
  type NotificationEvent,
  type RenderedNotification,
  entityIdOf,
} from './events/catalog';
import { NotificationTemplateService } from './notification-template.service';
import {
  NOTIFICATION_DELIVERY_REPOSITORY,
  type INotificationDeliveryRepository,
} from './notification-delivery.repository';
import {
  NOTIFICATION_PREFERENCE_REPOSITORY,
  type INotificationPreferenceRepository,
} from './notification-preference.repository';
import { SYSTEM_NOTIFICATION_QUEUE } from '../shared/queue/queue.constants';
import { decideChannels } from './preference-policy';
import { MessagingEventBus } from '../messaging/messaging-event-bus';
import { AnalyticsEventBus } from '../analytics/analytics-event-bus';
import { makeServerEvent } from '../analytics/events/catalog';

/**
 * Central notification dispatch service.
 *
 * `emit(event)` is BEST-EFFORT and NEVER throws into the caller:
 *   - The entire body is wrapped in try/catch (log + swallow).
 *   - Each channel enqueue is isolated in its own try/catch so a failing
 *     Redis call cannot block other channels.
 *
 * Idempotency is guaranteed via `notification_deliveries.dedupe_key`:
 *   - The in-app delivery record is the idempotency gate; if `created===false`
 *     the event was already delivered and we return immediately.
 *   - Each pref-gated channel uses its own dedupe_key so a retry of the whole
 *     event will silently skip channels already queued.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly log = new Logger(NotificationsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    @Inject(NOTIFICATION_DELIVERY_REPOSITORY)
    private readonly deliveries: INotificationDeliveryRepository,
    @Inject(NOTIFICATION_PREFERENCE_REPOSITORY)
    private readonly prefRepo: INotificationPreferenceRepository,
    @InjectQueue(SYSTEM_NOTIFICATION_QUEUE) private readonly queue: Queue,
    private readonly bus: NotificationEventBus,
    private readonly templates: NotificationTemplateService,
    private readonly messagingBus: MessagingEventBus,
    @Optional() private readonly analytics?: AnalyticsEventBus,
  ) {}

  /** Subscribe to the global bus: every producer-emitted event flows to emit(). */
  onModuleInit(): void {
    this.bus.events$.subscribe((event) => {
      void this.emit(event);
    });
  }

  async emit(event: NotificationEvent): Promise<void> {
    try {
      const admin = this.supabase.admin;
      const base = `${event.type}:${entityIdOf(event)}:${event.userId}`;

      // ── in-app delivery = the idempotency gate ────────────────────────────
      // Record as 'queued' (an INTENT), not 'sent'. It is only promoted to
      // 'sent' once the feed row is durably written. This keeps delivery state
      // honest and — critically — lets us RELEASE the dedupe lock (delete the
      // gate row) if the feed insert fails, so a later emit can retry instead
      // of the event being permanently, silently lost.
      const gate = await this.deliveries.record(admin, {
        userId: event.userId,
        eventType: event.type,
        channel: 'in_app',
        status: 'queued',
        dedupeKey: `${base}:in_app`,
      });
      if (!gate.created) return; // already delivered — skip everything

      // Load prefs once (drives both the locale for template rendering and the
      // channel policy below), then render — an active template overrides the
      // catalog copy in the recipient's language, else the catalog is used.
      // NON-FATAL: a prefs-fetch failure must NOT lose the in-app notification
      // (the feed insert below is the durable record). On failure, render in the
      // default locale and skip the interruptive channels.
      const prefs = await this.prefRepo
        .getForUser(admin, event.userId)
        .catch(() => null);
      const r = await this.templates.render(event, prefs?.language ?? 'en');

      // ── insert the notifications feed row ─────────────────────────────────
      const { data: notif, error } = await admin
        .from('notifications')
        .insert({
          user_id: event.userId,
          type: event.type,
          category: r.category,
          title: r.title,
          body: r.body,
          link: r.link,
          data: event.data ?? {},
        })
        .select('id')
        .single();
      if (error) {
        // Release the dedupe lock so a retry can succeed (avoid permanent loss).
        await this.deliveries.deleteById(admin, gate.id).catch(() => undefined);
        throw error;
      }

      await this.deliveries.attachNotification(admin, gate.id, notif.id);
      // Feed row is durable — now the in-app delivery is truly 'sent'.
      await this.deliveries.markStatus(admin, gate.id, 'sent');
      // Analytics: the in-app channel is the single common delivery-success
      // point (always attempted, unlike the pref-gated channels below). The
      // email/web_push/sms channels are only ENQUEUED here — their own
      // delivery confirmation happens later in the queue processors
      // (notification-email.processor.ts, system-notification.processor.ts)
      // and is NOT mirrored in this pass — documented deferral.
      this.analytics?.emitSafe(
        makeServerEvent('notification.sent', {
          user_id: event.userId,
          props: { channel: 'in_app', category: r.category ?? null },
        }),
      );

      // ── realtime signal ───────────────────────────────────────────────────
      // The feed row is durable — tell the recipient's live SSE stream to
      // refetch. Reuses the messaging per-user bus (one connection per tab);
      // best-effort, a publish failure must never affect delivery.
      try {
        this.messagingBus.emit({
          type: 'notification',
          conversation_id: '',
          application_id: '',
          recipient_ids: [event.userId],
        });
      } catch (e) {
        this.log.warn(
          `notification stream publish failed: ${(e as Error).message}`,
        );
      }

      // ── pref-gated channel enqueues ───────────────────────────────────────
      // In-app is already delivered above (always). Email/web-push are gated by
      // the pure policy: per-category opt-out + master switches, and DELAYED
      // (not dropped) during the recipient's quiet hours.
      // If prefs failed to load, in-app is already delivered — skip email/push/sms
      // rather than guess a policy.
      const decision = prefs
        ? decideChannels({ prefs, category: r.category, now: new Date() })
        : { inApp: true, email: false, push: false, sms: false, delayMs: 0 };
      if (decision.email) {
        await this.enqueue(
          'email',
          event,
          r,
          notif.id,
          `${base}:email`,
          decision.delayMs,
        );
      }
      if (decision.push) {
        await this.enqueue(
          'web_push',
          event,
          r,
          notif.id,
          `${base}:web_push`,
          decision.delayMs,
        );
      }
      if (decision.sms) {
        await this.enqueue(
          'sms',
          event,
          r,
          notif.id,
          `${base}:sms`,
          decision.delayMs,
        );
      }
    } catch (err) {
      this.log.error(`emit(${event.type}) failed: ${(err as Error).message}`);
    }
  }

  private async enqueue(
    channel: string,
    event: NotificationEvent,
    r: RenderedNotification,
    notificationId: string,
    dedupeKey: string,
    delayMs = 0,
  ): Promise<void> {
    try {
      const admin = this.supabase.admin;
      const del = await this.deliveries.record(admin, {
        notificationId,
        userId: event.userId,
        eventType: event.type,
        channel: channel as 'email' | 'web_push' | 'sms',
        status: 'queued',
        dedupeKey,
      });
      if (!del.created) return; // already queued

      await this.queue.add(
        channel,
        {
          deliveryId: del.id,
          userId: event.userId,
          title: r.title,
          body: r.body,
          link: r.link,
        },
        {
          delay: delayMs,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
    } catch (err) {
      this.log.error(`enqueue ${channel} failed: ${(err as Error).message}`);
    }
  }
}
