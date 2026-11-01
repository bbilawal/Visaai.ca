import { Global, Module } from '@nestjs/common';
import { NotificationEventBus } from './notification-event-bus';

/**
 * Global so any module (consultant, billing, vri, …) can inject
 * NotificationEventBus to EMIT notification events without importing the
 * NotificationsModule — keeps producers decoupled from dispatch and avoids
 * circular module deps. Mirrors realtime/EventBusModule.
 */
@Global()
@Module({
  providers: [NotificationEventBus],
  exports: [NotificationEventBus],
})
export class NotificationBusModule {}
