import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AppNotification,
  Conversation,
  ConversationParticipant,
  ConversationStatus,
  GlobalMessageSearchResult,
  Message,
  MessageCategory,
} from '@visaai/types';

export interface InsertMessageInput {
  conversationId: string;
  senderId: string;
  senderRole: 'user' | 'consultant' | 'admin';
  category: MessageCategory;
  body: string;
  parentMessageId: string | null;
  /**
   * Caller-supplied idempotency key (mobile offline queue). When set, a replay
   * of the same key by the same sender in the same conversation resolves to the
   * existing message instead of inserting a duplicate.
   */
  clientId?: string | null;
}

export interface NotificationInsert {
  userId: string;
  type: string;
  conversationId: string;
  messageId: string | null;
}

/**
 * Data-access contract for the messaging spine. Request-path methods take the
 * caller's RLS-scoped client (`db`) so isolation is enforced by Postgres.
 * `insertNotifications` is the ONLY method that uses the service-role client —
 * it writes rows owned by OTHER users (the recipients), which RLS forbids.
 */
export interface IMessagingRepository {
  getConversationByApplication(
    db: SupabaseClient,
    applicationId: string,
  ): Promise<Conversation | null>;

  insertConversation(
    db: SupabaseClient,
    applicationId: string,
  ): Promise<Conversation>;

  listMessages(db: SupabaseClient, conversationId: string): Promise<Message[]>;

  /** Newest-first window of messages, optionally older than `before` (created_at ISO). */
  listMessagesPage(
    db: SupabaseClient,
    conversationId: string,
    limit: number,
    before: string | null,
  ): Promise<Message[]>;

  insertMessage(
    db: SupabaseClient,
    input: InsertMessageInput,
  ): Promise<Message>;

  /** Existing message for an idempotency key, or null. */
  findByClientId(
    db: SupabaseClient,
    conversationId: string,
    senderId: string,
    clientId: string,
  ): Promise<Message | null>;

  touchLastMessageAt(
    db: SupabaseClient,
    conversationId: string,
    at: string,
  ): Promise<void>;

  setStatus(
    db: SupabaseClient,
    conversationId: string,
    status: ConversationStatus,
  ): Promise<Conversation>;

  /** Set the consultant triage state. Service-role only (column REVOKE'd from authenticated). */
  setConsultantState(
    db: SupabaseClient,
    conversationId: string,
    state: import('@visaai/types').ConsultantState,
  ): Promise<void>;

  /** Advance the caller's own read watermark. */
  advanceLastRead(
    db: SupabaseClient,
    conversationId: string,
    userId: string,
    at: string,
  ): Promise<void>;

  /** Caller's own watermark, for unread computation. */
  getLastRead(
    db: SupabaseClient,
    conversationId: string,
    userId: string,
  ): Promise<string | null>;

  /** Count messages from OTHER senders after the recipient's watermark (head count, RLS-scoped). */
  countUnread(
    db: SupabaseClient,
    conversationId: string,
    recipientId: string,
    watermark: string | null,
  ): Promise<number>;

  listNotifications(
    db: SupabaseClient,
    userId: string,
  ): Promise<AppNotification[]>;

  markNotificationsRead(
    db: SupabaseClient,
    userId: string,
    at: string,
  ): Promise<void>;

  // ── service-role (system) paths ──────────────────────────────────────
  /** Seed participant rows (owner + assigned consultant). Service-role. */
  upsertParticipant(
    admin: SupabaseClient,
    conversationId: string,
    userId: string,
    role: 'user' | 'consultant' | 'admin',
  ): Promise<void>;

  /** Insert notification rows for recipients. Service-role. */
  insertNotifications(
    admin: SupabaseClient,
    rows: NotificationInsert[],
  ): Promise<void>;

  /** Resolve the application owner + ALL active consultants (primary + backups). */
  getApplicationParties(
    admin: SupabaseClient,
    applicationId: string,
  ): Promise<{ ownerId: string | null; consultantIds: string[] }>;

  /** All participant rows for a conversation (service-role read — receipts). */
  listParticipants(
    admin: SupabaseClient,
    conversationId: string,
  ): Promise<ConversationParticipant[]>;

  /** Advance delivered_at for the given recipients in one conversation (service-role). */
  advanceDelivered(
    admin: SupabaseClient,
    conversationId: string,
    userIds: string[],
    at: string,
  ): Promise<void>;

  /** Advance delivered_at for ALL of a user's participant rows (service-role). */
  advanceDeliveredForUser(
    admin: SupabaseClient,
    userId: string,
    at: string,
  ): Promise<void>;

  /** Full-text search of message bodies within a conversation (RLS-scoped client). */
  searchMessages(
    db: SupabaseClient,
    conversationId: string,
    query: string,
    limit: number,
  ): Promise<Message[]>;

  /** Global FTS across ALL conversations the caller can see (RLS-scoped client). */
  searchAllMessages(
    db: SupabaseClient,
    query: string,
    limit: number,
  ): Promise<GlobalMessageSearchResult[]>;
}

export const MESSAGING_REPOSITORY = Symbol('IMessagingRepository');
