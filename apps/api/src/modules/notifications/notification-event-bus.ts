import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { NotificationEvent } from './events/catalog';

/**
 * NotificationEventBus — in-process pub/sub seam decoupling producer modules
 * (assignment, billing, vri, …) from the notification dispatch layer. Producers
 * `emit()` a typed `NotificationEvent` and know NOTHING about channels, queues,
 * or delivery; `NotificationsService` subscribes and does the work.
 *
 * Provided by a `@Global` module so any service can inject it to emit without
 * importing NotificationsModule — avoids circular module deps (same pattern as
 * AssignmentEventBus). Stateless; swap the Subject for a Redis fan-out later
 * without touching producers.
 */
@Injectable()
export class NotificationEventBus {
  private readonly subject = new Subject<NotificationEvent>();

  get events$(): Observable<NotificationEvent> {
    return this.subject.asObservable();
  }

  emit(event: NotificationEvent): void {
    this.subject.next(event);
  }
}
