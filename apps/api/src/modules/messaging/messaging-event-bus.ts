import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { MessagingBusEvent } from './messaging.types';

/**
 * MessagingEventBus — in-proc pub/sub seam decoupling MessagingService from the
 * SSE delivery layer. Single hot Subject; one subscriber per SSE connection
 * filters for its own user via `isRecipient`. Swap the Subject for a
 * Redis-backed Observable later for horizontal scale; nothing else changes.
 */
@Injectable()
export class MessagingEventBus {
  private readonly subject = new Subject<MessagingBusEvent>();

  emit(e: Omit<MessagingBusEvent, 'timestamp'> & { timestamp?: string }): void {
    this.subject.next({
      ...e,
      timestamp: e.timestamp ?? new Date().toISOString(),
    });
  }

  get events(): Observable<MessagingBusEvent> {
    return this.subject.asObservable();
  }
}

/** Pure per-connection filter: does this event target this user? */
export function isRecipient(e: MessagingBusEvent, userId: string): boolean {
  return e.recipient_ids.includes(userId);
}
