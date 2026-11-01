import { Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { EmailService } from '../shared/email/email.service';
import { WebPushService } from '../shared/push/web-push.service';
import { SmsService } from '../shared/sms/sms.service';
import { SYSTEM_NOTIFICATION_QUEUE } from '../shared/queue/queue.constants';
import {
  NOTIFICATION_DELIVERY_REPOSITORY,
  type INotificationDeliveryRepository,
} from './notification-delivery.repository';
import {
  PUSH_SUBSCRIPTION_REPOSITORY,
  type IPushSubscriptionRepository,
} from './push-subscription.repository';
import type { Env } from '../../config/configuration';

interface SystemNotificationJobData {
  deliveryId: string;
  userId: string;
  title: string;
  body: string;
  link: string;
}

/**
 * Processes jobs on the `system-notifications` queue.
 *
 * Job names:
 *   'email'    — resolve recipient email → send via EmailService
 *   'web_push' — list push subscriptions → send via WebPushService; prune gone subs
 *
 * Delivery tracking:
 *   - On success: markStatus(deliveryId, 'sent')
 *   - On throw: rethrow so BullMQ can retry (attempts:3, exponential backoff)
 *   - @OnWorkerEvent('failed'): DLQ on final attempt (dead), else 'failed'
 */
@Processor(SYSTEM_NOTIFICATION_QUEUE)
export class SystemNotificationProcessor extends WorkerHost {
  private readonly log = new Logger(SystemNotificationProcessor.name);
  private readonly webUrl: string;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly email: EmailService,
    private readonly webPush: WebPushService,
    private readonly sms: SmsService,
    @Inject(PUSH_SUBSCRIPTION_REPOSITORY)
    private readonly pushRepo: IPushSubscriptionRepository,
    @Inject(NOTIFICATION_DELIVERY_REPOSITORY)
    private readonly deliveries: INotificationDeliveryRepository,
    config: ConfigService<Env>,
  ) {
    super();
    this.webUrl =
      config.get('WEB_URL', { infer: true }) ?? 'http://localhost:3000';
  }

  /** Escape untrusted text before interpolating into email HTML. */
  private esc(s: string): string {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Resolve a deep link to a safe absolute URL. Only same-origin relative paths
   * (starting with a single `/`) are honored; anything else (protocol-relative,
   * absolute, `javascript:`, …) falls back to the app root — no open redirect /
   * script injection via the `href`.
   */
  private safeUrl(link: string): string {
    return typeof link === 'string' && /^\/(?!\/)/.test(link)
      ? `${this.webUrl}${link}`
      : this.webUrl;
  }

  async process(job: Job<SystemNotificationJobData>): Promise<void> {
    const { deliveryId, userId, title, body, link } = job.data;
    const admin = this.supabase.admin;

    if (job.name === 'email') {
      // Resolve recipient email via service-role Auth API
      const { data: userData, error } =
        await admin.auth.admin.getUserById(userId);
      if (error || !userData?.user?.email) {
        this.log.warn(
          `email job ${job.id}: no email for user ${userId}, marking skipped`,
        );
        await this.deliveries.markStatus(admin, deliveryId, 'skipped');
        return;
      }

      const htmlBody = `
        <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px">
          <h2 style="margin:0 0 8px">${this.esc(title)}</h2>
          <p style="margin:0 0 16px;color:#444">${this.esc(body)}</p>
          <a href="${this.safeUrl(link)}"
             style="display:inline-block;padding:10px 20px;background:#000;color:#fff;text-decoration:none;border-radius:4px">
            View details
          </a>
        </div>
      `;

      await this.email.send(userData.user.email, title, htmlBody);
      await this.deliveries.markStatus(admin, deliveryId, 'sent');
      return;
    }

    if (job.name === 'web_push') {
      const subs = await this.pushRepo.listForUser(admin, userId);

      for (const sub of subs) {
        const result = await this.webPush.send(
          { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
          { title, body, url: this.safeUrl(link), tag: deliveryId },
        );
        if (result === 'gone') {
          await this.pushRepo.deleteByEndpoint(admin, sub.endpoint);
        }
      }

      await this.deliveries.markStatus(admin, deliveryId, 'sent');
      return;
    }

    if (job.name === 'sms') {
      const { data: profile } = await admin
        .from('user_profiles')
        .select('phone')
        .eq('user_id', userId)
        .maybeSingle();
      const phone = (profile as { phone?: string | null } | null)?.phone;
      if (!phone) {
        this.log.warn(
          `sms job ${job.id}: no phone for user ${userId}, marking skipped`,
        );
        await this.deliveries.markStatus(admin, deliveryId, 'skipped');
        return;
      }
      // Link first so a long title can't truncate the deep link away.
      const result = await this.sms.send(
        phone,
        `${this.safeUrl(link)} — ${title}`,
      );
      if (result === 'unconfigured') {
        // Provider not configured — don't spam the DLQ with retries; skip like
        // email/push degrade gracefully when their transport is unset.
        await this.deliveries.markStatus(admin, deliveryId, 'skipped');
        return;
      }
      if (result !== 'ok') throw new Error('sms send failed'); // retry → DLQ on exhaustion
      await this.deliveries.markStatus(admin, deliveryId, 'sent');
      return;
    }

    this.log.warn(
      `system-notifications: unknown job name '${job.name}' — skipping`,
    );
  }

  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<SystemNotificationJobData>,
    err: Error,
  ): Promise<void> {
    const deliveryId = job.data?.deliveryId;
    if (!deliveryId) return;

    const admin = this.supabase.admin;
    const maxAttempts = job.opts?.attempts ?? 1;

    if (job.attemptsMade >= maxAttempts) {
      // Final attempt exhausted — move to DLQ
      this.log.error(
        `system-notifications DLQ: job ${job.id} (${job.name}) exhausted ${maxAttempts} attempts. deliveryId=${deliveryId}`,
      );
      await this.deliveries
        .markStatus(admin, deliveryId, 'dead', err.message)
        .catch((e) =>
          this.log.error(`markStatus(dead) failed: ${(e as Error).message}`),
        );
    } else {
      // Transient failure — will be retried
      await this.deliveries
        .markStatus(admin, deliveryId, 'failed', err.message)
        .catch((e) =>
          this.log.error(`markStatus(failed) failed: ${(e as Error).message}`),
        );
    }
  }
}
