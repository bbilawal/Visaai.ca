import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  NOTIFICATION_QUEUE,
  SYSTEM_NOTIFICATION_QUEUE,
  BROADCAST_QUEUE,
  NOTIFICATION_OUTBOX_QUEUE,
  NOTIFICATION_DLQ_ALERT_QUEUE,
} from '../shared/queue/queue.constants';
import { MessagingModule } from '../messaging/messaging.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsUnsubscribeController } from './notifications-unsubscribe.controller';
import { PushSubscriptionService } from './push-subscription.service';
import { DeviceTokenService } from './device-token.service';
import { NotificationPreferenceService } from './notification-preference.service';
import { NotificationDispatchService } from './notification-dispatch.service';
import { NotificationEmailService } from './notification-email.service';
import { NotificationEmailProcessor } from './notification-email.processor';
import { NotificationsService } from './notifications.service';
import { NotificationFeedService } from './notification-feed.service';
import { SystemNotificationProcessor } from './system-notification.processor';
import { PUSH_SUBSCRIPTION_REPOSITORY } from './push-subscription.repository';
import { PushSubscriptionRepository } from './push-subscription.repository.impl';
import { DEVICE_TOKEN_REPOSITORY } from './device-token.repository';
import { DeviceTokenRepository } from './device-token.repository.impl';
import { NOTIFICATION_PREFERENCE_REPOSITORY } from './notification-preference.repository';
import { NotificationPreferenceRepository } from './notification-preference.repository.impl';
import { NOTIFICATION_DELIVERY_REPOSITORY } from './notification-delivery.repository';
import { NotificationDeliveryRepository } from './notification-delivery.repository.impl';
import { NotificationTemplateService } from './notification-template.service';
import { NotificationTemplatesController } from './notification-templates.controller';
import { NOTIFICATION_TEMPLATE_REPOSITORY } from './notification-template.repository';
import { NotificationTemplateRepository } from './notification-template.repository.impl';
import { NotificationOpsService } from './ops/notification-ops.service';
import { NotificationOpsController } from './ops/notification-ops.controller';
import { NotificationBroadcastService } from './broadcast/notification-broadcast.service';
import { BroadcastProcessor } from './broadcast/broadcast.processor';
import { NotificationBroadcastController } from './broadcast/notification-broadcast.controller';
import { NOTIFICATION_BROADCAST_REPOSITORY } from './broadcast/notification-broadcast.repository';
import { NotificationBroadcastRepository } from './broadcast/notification-broadcast.repository.impl';
import { OutboxProcessor } from './outbox/outbox.processor';
import { OutboxScheduler } from './outbox/outbox.scheduler';
import { OUTBOX_REPOSITORY } from './outbox/outbox.repository';
import { OutboxRepository } from './outbox/outbox.repository.impl';
import { DlqAlertScheduler } from './ops/dlq-alert.scheduler';
import { DlqAlertProcessor } from './ops/dlq-alert.processor';

/**
 * Off-platform notifications (P3b). Imports MessagingModule for the event bus +
 * presence + unread reads. WebPushService/EmailService/SupabaseService resolve
 * from @Global modules. NotificationDispatchService subscribes to the bus on
 * init; NotificationEmailProcessor consumes the debounced email queue.
 *
 * Task 4 additions:
 *   - SYSTEM_NOTIFICATION_QUEUE registration for the new backbone queue
 *   - SystemNotificationProcessor: handles email + web_push delivery + DLQ
 *   - NotificationsService: central emit() with in-app feed + pref-gated channels
 *   - NotificationDeliveryRepository: per-channel delivery tracking
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: NOTIFICATION_QUEUE }),
    BullModule.registerQueue({ name: SYSTEM_NOTIFICATION_QUEUE }),
    BullModule.registerQueue({ name: BROADCAST_QUEUE }),
    BullModule.registerQueue({ name: NOTIFICATION_OUTBOX_QUEUE }),
    BullModule.registerQueue({ name: NOTIFICATION_DLQ_ALERT_QUEUE }),
    MessagingModule,
  ],
  controllers: [
    NotificationsController,
    NotificationsUnsubscribeController,
    NotificationTemplatesController,
    NotificationOpsController,
    NotificationBroadcastController,
  ],
  providers: [
    PushSubscriptionService,
    DeviceTokenService,
    NotificationPreferenceService,
    NotificationDispatchService,
    NotificationEmailService,
    NotificationEmailProcessor,
    NotificationsService,
    NotificationFeedService,
    SystemNotificationProcessor,
    NotificationTemplateService,
    NotificationOpsService,
    NotificationBroadcastService,
    BroadcastProcessor,
    OutboxProcessor,
    OutboxScheduler,
    DlqAlertProcessor,
    DlqAlertScheduler,
    { provide: OUTBOX_REPOSITORY, useClass: OutboxRepository },
    {
      provide: NOTIFICATION_BROADCAST_REPOSITORY,
      useClass: NotificationBroadcastRepository,
    },
    {
      provide: PUSH_SUBSCRIPTION_REPOSITORY,
      useClass: PushSubscriptionRepository,
    },
    { provide: DEVICE_TOKEN_REPOSITORY, useClass: DeviceTokenRepository },
    {
      provide: NOTIFICATION_PREFERENCE_REPOSITORY,
      useClass: NotificationPreferenceRepository,
    },
    {
      provide: NOTIFICATION_DELIVERY_REPOSITORY,
      useClass: NotificationDeliveryRepository,
    },
    {
      provide: NOTIFICATION_TEMPLATE_REPOSITORY,
      useClass: NotificationTemplateRepository,
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
