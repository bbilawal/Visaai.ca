import type { MessagingEventType } from '@visaai/types';

/**
 * Internal domain event raised when a message/status/typing event occurs.
 * Carries recipient ids so the SSE layer can filter per-connection without
 * any DB lookup. Never carries message bodies (Option A: client refetches).
 */
export interface MessagingBusEvent {
  type: MessagingEventType;
  conversation_id: string;
  application_id: string;
  /** auth user ids that should receive this event (excludes the actor). */
  recipient_ids: string[];
  timestamp: string;
}
