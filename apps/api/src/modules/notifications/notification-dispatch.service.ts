import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { MessagingEventBus } from '../messaging/messaging-event-bus';
import { MessagingPresenceService } from '../messaging/messaging-presence.service';
import type { MessagingBusEvent } from '../messaging/messaging.types';
import { WebPushService } from '../shared/push/web-push.service';
import { ExpoPushService } from '../shared/push/expo-push.service';
import { NOTIFICATION_QUEUE } from '../shared/queue/queue.constants';
import {
  PUSH_SUBSCRIPTION_REPOSITORY,
  type IPushSubscriptionRepository,
} from './push-subscription.repository';
import {
  DEVICE_TOKEN_REPOSITORY,
  type IDeviceTokenRepository,
} from './device-token.repository';
import {
  NOTIFICATION_PREFERENCE_REPOSITORY,
  type INotificationPreferenceRepository,
} from './notification-preference.repository';
import type { NotificationEmailJob } from './notification-email.service';
import type { Env } from '../../config/configuration';

const TRIGGERS = new Set(['message.created', 'document_request.created']);

/**
 * Off-platform fan-out. Subscribes to the in-proc MessagingEventBus (the same
 * seam as the SSE controller). Per recipient: push immediately when away, and
 * enqueue a debounced/coalesced email job (fixed jobId per conversation+recipient
 * → a burst becomes one job). Reads prefs/subscriptions via the service-role
 * client (cross-user system path). Per-recipient errors are isolated.
 */
@Injectable()
export class NotificationDispatchService implements OnModuleInit {
  private readonly log = new Logger(NotificationDispatchService.name);

  constructor(
    private readonly bus: MessagingEventBus,
    private readonly presence: MessagingPresenceService,
    private readonly supabase: SupabaseService,
    @Inject(PUSH_SUBSCRIPTION_REPOSITORY)
    private readonly pushRepo: IPushSubscriptionRepository,
    @Inject(DEVICE_TOKEN_REPOSITORY)
    private readonly deviceRepo: IDeviceTokenRepository,
    @Inject(NOTIFICATION_PREFERENCE_REPOSITORY)
    private readonly prefRepo: INotificationPreferenceRepository,
    private readonly webPush: WebPushService,
    private readonly expoPush: ExpoPushService,
    @InjectQueue(NOTIFICATION_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService<Env>,
  ) {}

  onModuleInit(): void {
    this.bus.events.subscribe((e) => {
      void this.handle(e);
    });
  }

  async handle(e: MessagingBusEvent): Promise<void> {
    if (!TRIGGERS.has(e.type)) return;
    for (const recipientId of e.recipient_ids) {
      try {
        await this.notifyRecipient(e, recipientId);
      } catch (err) {
        this.log.error(
          `dispatch failed for ${recipientId}: ${(err as Error).message}`,
        );
      }
    }
  }

  private async notifyRecipient(
    e: MessagingBusEvent,
    recipientId: string,
  ): Promise<void> {
    const admin = this.supabase.admin;
    const prefs = await this.prefRepo.getForUser(admin, recipientId);
    const online = this.presence.isOnline(recipientId);

    if (!online && prefs.push_enabled) {
      const subs = await this.pushRepo.listForUser(admin, recipientId);
      const webUrl =
        (this.config.get('WEB_URL', { infer: true }) as string) ??
        'http://localhost:3000';
      const payload = {
        title:
          e.type === 'document_request.created'
            ? 'Document requested'
            : 'New message',
        body: 'You have new activity in your application',
        url: `${webUrl}/applications/${e.application_id}/messages`,
        tag: e.conversation_id,
      };
      for (const s of subs) {
        const result = await this.webPush.send(s, payload);
        if (result === 'gone')
          await this.pushRepo.deleteByEndpoint(admin, s.endpoint);
      }

      await this.pushToDevices(recipientId, e, payload.title);
    }

    if (prefs.email_enabled) {
      const delay = Number(
        this.config.get('NOTIFICATION_EMAIL_DELAY_MS', { infer: true }) ??
          300000,
      );
      const data: NotificationEmailJob = {
        conversationId: e.conversation_id,
        applicationId: e.application_id,
        recipientId,
      };
      await this.queue.add('coalesced-email', data, {
        delay,
        jobId: `notif-email:${e.conversation_id}:${recipientId}`,
        removeOnComplete: true,
        removeOnFail: 50,
      });
    }
  }

  /**
   * Native (APNs/FCM) fan-out alongside Web Push. Failures are contained here:
   * a dead Expo endpoint must not stop the email leg of the same notification.
   *
   * The body is deliberately content-free. These notifications land on a lock
   * screen, so the message text, document name, and case status never leave the
   * app — the payload carries only ids the app resolves *after* authenticating.
   */
  private async pushToDevices(
    recipientId: string,
    e: MessagingBusEvent,
    title: string,
  ): Promise<void> {
    try {
      const admin = this.supabase.admin;
      const devices = await this.deviceRepo.listForUser(admin, recipientId);
      if (devices.length === 0) return;

      const results = await this.expoPush.sendToTokens(
        devices.map((d) => d.token),
        {
          title,
          body: 'You have new activity in your application',
          collapseId: e.conversation_id,
          data: {
            type: e.type,
            applicationId: e.application_id,
            conversationId: e.conversation_id,
            // Consumed by the app's deep-link router (src/notifications/routing.ts).
            path: `/applications/${e.application_id}/messages`,
          },
        },
      );

      for (const [token, result] of results) {
        if (result === 'gone')
          await this.deviceRepo.deleteByToken(admin, token);
      }
    } catch (err) {
      this.log.error(
        `device push failed for ${recipientId}: ${(err as Error).message}`,
      );
    }
  }
}
