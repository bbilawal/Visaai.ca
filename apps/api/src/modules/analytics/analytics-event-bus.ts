import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { AnalyticsEvent } from './events/catalog';

/**
 * In-process pub/sub seam decoupling domain producers from the analytics ingest
 * layer (mirrors NotificationEventBus). Producers emit a typed AnalyticsEvent
 * and know nothing about queues or storage. Provided by a @Global module so any
 * service can inject it without importing AnalyticsModule.
 */
@Injectable()
export class AnalyticsEventBus {
  private readonly log = new Logger(AnalyticsEventBus.name);
  private readonly subject = new Subject<AnalyticsEvent>();

  get events$(): Observable<AnalyticsEvent> {
    return this.subject.asObservable();
  }

  emit(event: AnalyticsEvent): void {
    this.subject.next(event);
  }

  /** Never propagates an error to the producer (the emit caller). Subscriber-side
   * failures are the subscriber's responsibility to contain. */
  emitSafe(event: AnalyticsEvent): void {
    try {
      this.subject.next(event);
    } catch (err) {
      this.log.warn(`analytics emit dropped: ${(err as Error).message}`);
    }
  }
}
