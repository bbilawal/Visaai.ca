import {
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AppNotification,
  ConsultantState,
  Conversation,
  ConversationParticipant,
  ConversationStatus,
  ConversationThread,
  MessagePage,
  GlobalMessageSearchResult,
  Message,
  MessageCategory,
} from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { MessagingEventBus } from './messaging-event-bus';
import { MessagingPresenceService } from './messaging-presence.service';
import {
  MESSAGING_REPOSITORY,
  type IMessagingRepository,
  type NotificationInsert,
} from './messaging.repository';

/** Minimal caller identity (subset of AuthUser) for authorization + roles. */
export interface MessagingCaller {
  id: string;
  appRole?: 'admin' | 'consultant' | 'user';
}

export interface PostMessageInput {
  body: string;
  category: MessageCategory;
  parentMessageId?: string | null;
  /** Optional idempotency key — see postMessage. */
  clientId?: string | null;
}

/** Upper bound on a search query fed to Postgres FTS. */
const MAX_SEARCH_QUERY_LEN = 200;

/** Messages returned per thread page (initial open + each "load older"). */
const MESSAGES_PAGE_SIZE = 50;

/**
 * MessagingService — request-path orchestration. RLS (via forUser) is the
 * isolation boundary; this service adds get-or-create, participant seeding,
 * unread computation, notification fan-out (service-role), and bus emission.
 * It knows nothing about streaming (the SSE controller subscribes to the bus).
 */
@Injectable()
export class MessagingService {
  constructor(
    @Inject(MESSAGING_REPOSITORY)
    private readonly repo: IMessagingRepository,
    private readonly bus: MessagingEventBus,
    private readonly supabase: SupabaseService,
    @Optional() private readonly presence?: MessagingPresenceService,
  ) {}

  /**
   * Get-or-create the conversation for an application, seeding participants.
   * Public so the P2 attachment/voice/document-request services can resolve
   * (and lazily create) the conversation a row attaches to.
   */
  /**
   * SEC-105: authorize before creating anything.
   *
   * This used to look the conversation up under the caller's RLS scope and, on
   * not finding one, go straight to INSERT. For a caller with no right to the
   * application that meant RLS hid the row, the insert was attempted anyway,
   * RLS rejected it, and the repository rethrew the driver error as a bare
   * `Error` — a 500. So an unauthorized probe both looked like a server fault
   * and drove a write attempt against the database on every request.
   *
   * The check reads the application under the CALLER'S scoped client, which
   * makes RLS the authority rather than duplicating "owner or assigned
   * consultant" in TypeScript where it could drift from the policies. Invisible
   * row -> 403, identically for an id that does not exist, so it is not an
   * existence oracle.
   */
  private async assertApplicationAccess(
    db: SupabaseClient,
    applicationId: string,
  ): Promise<void> {
    const { data } = await db
      .from('applications')
      .select('id')
      .eq('id', applicationId)
      .maybeSingle();
    if (!data) throw new ForbiddenException('Access denied');
  }

  public async ensureConversation(
    token: string,
    applicationId: string,
  ): Promise<Conversation> {
    const db = this.supabase.forUser(token);
    await this.assertApplicationAccess(db, applicationId);
    const existing = await this.repo.getConversationByApplication(
      db,
      applicationId,
    );
    if (existing) return existing;
    const created = await this.repo.insertConversation(db, applicationId);
    // Seed participants via service-role (the user cannot insert the
    // consultant's participant row under RLS).
    const parties = await this.repo.getApplicationParties(
      this.supabase.admin,
      applicationId,
    );
    if (parties.ownerId) {
      await this.repo.upsertParticipant(
        this.supabase.admin,
        created.id,
        parties.ownerId,
        'user',
      );
    }
    for (const consultantId of parties.consultantIds) {
      await this.repo.upsertParticipant(
        this.supabase.admin,
        created.id,
        consultantId,
        'consultant',
      );
    }
    return created;
  }

  async getThread(
    token: string,
    caller: MessagingCaller,
    applicationId: string,
  ): Promise<ConversationThread> {
    const conversation = await this.ensureConversation(token, applicationId);
    const db = this.supabase.forUser(token);
    const page = await this.repo.listMessagesPage(
      db,
      conversation.id,
      MESSAGES_PAGE_SIZE + 1,
      null,
    );
    const has_more = page.length > MESSAGES_PAGE_SIZE;
    const messages = page.slice(0, MESSAGES_PAGE_SIZE).reverse(); // newest window, ascending for render
    const watermark = await this.repo.getLastRead(
      db,
      conversation.id,
      caller.id,
    );
    const unread_count = await this.repo.countUnread(
      db,
      conversation.id,
      caller.id,
      watermark,
    );
    const seeded = await this.repo.listParticipants(
      this.supabase.admin,
      conversation.id,
    );
    const participants = await this.ensureCallerParticipant(
      conversation.id,
      caller,
      seeded,
    );
    return { conversation, messages, unread_count, participants, has_more };
  }

  /**
   * Self-heal the caller's participant row. Creation-time seeding only covers
   * the parties active when the conversation was first created; a consultant
   * assigned LATER (e.g. self-claimed from the queue) opens an already-existing
   * conversation and would otherwise have no conversation_participants row —
   * leaving their read watermark unwritable (advanceLastRead matches no row), so
   * the thread can never be marked read and unread stays inflated. RLS already
   * authorized the caller (owner OR active assignee) to reach this conversation,
   * so upserting their own row is always valid. Admins are oversight, not a
   * conversation party, so are never seeded. Idempotent and skipped when the row
   * already exists, so the steady state costs no write.
   */
  private async ensureCallerParticipant(
    conversationId: string,
    caller: MessagingCaller,
    participants: ConversationParticipant[],
  ): Promise<ConversationParticipant[]> {
    if (caller.appRole === 'admin') return participants;
    if (participants.some((p) => p.user_id === caller.id)) return participants;
    await this.repo.upsertParticipant(
      this.supabase.admin,
      conversationId,
      caller.id,
      caller.appRole === 'consultant' ? 'consultant' : 'user',
    );
    return this.repo.listParticipants(this.supabase.admin, conversationId);
  }

  /**
   * A page of messages strictly older than `before` (created_at ISO), ascending.
   * RLS-scoped (forUser). Empty for a blank cursor or missing conversation.
   */
  async listOlderMessages(
    token: string,
    _caller: MessagingCaller,
    applicationId: string,
    before: string,
    limit: number,
  ): Promise<MessagePage> {
    const n =
      Number.isFinite(limit) && limit > 0
        ? Math.min(limit, 100)
        : MESSAGES_PAGE_SIZE;
    const db = this.supabase.forUser(token);
    // SEC-105: this route answered 200 with an empty page to a caller with no
    // right to the application. RLS meant nothing leaked, but "no messages" and
    // "not your application" are different answers and the client cannot tell
    // them apart. Authorize first, exactly as ensureConversation now does.
    await this.assertApplicationAccess(db, applicationId);
    if (!before) return { messages: [], has_more: false };
    const conversation = await this.repo.getConversationByApplication(
      db,
      applicationId,
    );
    if (!conversation) return { messages: [], has_more: false };
    const page = await this.repo.listMessagesPage(
      db,
      conversation.id,
      n + 1,
      before,
    );
    const has_more = page.length > n;
    return { messages: page.slice(0, n).reverse(), has_more };
  }

  async postMessage(
    token: string,
    caller: MessagingCaller,
    applicationId: string,
    input: PostMessageInput,
  ): Promise<{ id: string }> {
    const conversation = await this.ensureConversation(token, applicationId);
    const db = this.supabase.forUser(token);
    const senderRole: 'user' | 'consultant' | 'admin' =
      caller.appRole === 'admin'
        ? 'admin'
        : caller.appRole === 'consultant'
          ? 'consultant'
          : 'user';
    // Idempotency (mobile offline queue). A replayed send whose original
    // response was lost must resolve to the SAME message, not a second one.
    // Checked before insert to cover the common case, and again in the catch
    // below to cover the race where two replays arrive concurrently — the
    // partial unique index is the authority, this read is only a fast path.
    // A replay must converge on the same message AND still complete the side
    // effects. The original request can die after the INSERT but before
    // notifications are written — returning early there left the recipient with
    // no push and no SSE frame, so the message was invisible until a manual
    // refresh. That is precisely the failure the offline queue exists to repair.
    if (input.clientId) {
      const existing = await this.repo.findByClientId(
        db,
        conversation.id,
        caller.id,
        input.clientId,
      );
      if (existing) {
        await this.completeMessageSideEffects(
          db,
          conversation.id,
          applicationId,
          caller,
          existing,
        );
        return { id: existing.id };
      }
    }

    let message: Message;
    try {
      message = await this.repo.insertMessage(db, {
        conversationId: conversation.id,
        senderId: caller.id,
        senderRole,
        category: input.category,
        body: input.body,
        parentMessageId: input.parentMessageId ?? null,
        clientId: input.clientId ?? null,
      });
    } catch (err) {
      const text = (err as Error).message ?? '';
      const isDuplicateKey =
        input.clientId &&
        (text.includes('messages_client_id_unique') ||
          text.includes('duplicate key'));
      if (!isDuplicateKey) throw err;
      const existing = await this.repo.findByClientId(
        db,
        conversation.id,
        caller.id,
        input.clientId as string,
      );
      // A duplicate-key error with no readable row would mean the index fired
      // on something else; surfacing the original error beats inventing an id.
      if (!existing) throw err;
      await this.completeMessageSideEffects(
        db,
        conversation.id,
        applicationId,
        caller,
        existing,
      );
      return { id: existing.id };
    }
    await this.completeMessageSideEffects(
      db,
      conversation.id,
      applicationId,
      caller,
      message,
    );
    return { id: message.id };
  }

  /**
   * Everything that must happen after a message row exists: conversation
   * timestamp, recipient notifications, the SSE/bus event, and delivered
   * receipts.
   *
   * Extracted so the IDEMPOTENT REPLAY path can run it too. These steps are
   * individually idempotent-enough (notification inserts are deduped by the
   * feed, the bus event is transient), and re-running them is strictly better
   * than the alternative: a replay that returns the original id while the
   * recipient never learns the message exists.
   */
  private async completeMessageSideEffects(
    db: SupabaseClient,
    conversationId: string,
    applicationId: string,
    caller: MessagingCaller,
    message: Message,
  ): Promise<void> {
    await this.repo.touchLastMessageAt(db, conversationId, message.created_at);

    const recipients = await this.recipientIds(applicationId, caller.id);
    const notifications: NotificationInsert[] = recipients.map((userId) => ({
      userId,
      type: 'message.received',
      conversationId,
      messageId: message.id,
    }));
    await this.repo.insertNotifications(this.supabase.admin, notifications);

    this.bus.emit({
      type: 'message.created',
      conversation_id: conversationId,
      application_id: applicationId,
      recipient_ids: recipients,
    });

    // Delivered receipts: recipients holding a live SSE connection have received
    // this message's frame. Advance their delivered_at + tell the sender so their
    // thread shows "Delivered". Non-fatal — must never fail the send.
    const onlineRecipients = this.presence
      ? recipients.filter((id) => this.presence!.isOnline(id))
      : [];
    if (onlineRecipients.length > 0) {
      await this.repo
        .advanceDelivered(
          this.supabase.admin,
          conversationId,
          onlineRecipients,
          message.created_at,
        )
        .catch(() => undefined);
      this.bus.emit({
        type: 'message.delivered',
        conversation_id: conversationId,
        application_id: applicationId,
        recipient_ids: [caller.id],
      });
    }
  }

  async markRead(
    token: string,
    caller: MessagingCaller,
    applicationId: string,
  ): Promise<void> {
    const db = this.supabase.forUser(token);
    const conversation = await this.repo.getConversationByApplication(
      db,
      applicationId,
    );
    // Intentional no-op when no conversation exists yet: marking-read must never
    // create a conversation as a side effect (unlike the write paths, which
    // call ensureConversation). Do not "fix" this by adding ensureConversation.
    if (!conversation) return;
    await this.repo.advanceLastRead(
      db,
      conversation.id,
      caller.id,
      new Date().toISOString(),
    );
    const recipients = await this.recipientIds(applicationId, caller.id);
    this.bus.emit({
      type: 'message.read',
      conversation_id: conversation.id,
      application_id: applicationId,
      recipient_ids: recipients,
    });
  }

  /**
   * Marks every conversation of a just-connected user as delivered-through-now.
   * Covers "recipient came online after the message was sent". The sender's open
   * thread picks this up on its next refetch (no event emitted — connect is a
   * background signal; minor staleness is acceptable). Non-fatal.
   */
  async markDeliveredOnConnect(userId: string): Promise<void> {
    await this.repo
      .advanceDeliveredForUser(
        this.supabase.admin,
        userId,
        new Date().toISOString(),
      )
      .catch(() => undefined);
  }

  /**
   * Full-text search within one application's conversation. Empty query → [].
   * Runs through forUser, so RLS restricts results to the caller's conversation.
   */
  async searchInConversation(
    token: string,
    _caller: MessagingCaller,
    applicationId: string,
    query: string,
  ): Promise<Message[]> {
    const q = query.trim().slice(0, MAX_SEARCH_QUERY_LEN);
    if (!q) return [];
    const db = this.supabase.forUser(token);
    const conversation = await this.repo.getConversationByApplication(
      db,
      applicationId,
    );
    if (!conversation) return [];
    return this.repo.searchMessages(db, conversation.id, q, 50);
  }

  /**
   * Global full-text search across every conversation the caller can see.
   * Empty query → []. Runs through forUser, so RLS scopes results to the
   * caller's conversations — no explicit role/ownership check needed.
   */
  async searchAllConversations(
    token: string,
    _caller: MessagingCaller,
    query: string,
  ): Promise<GlobalMessageSearchResult[]> {
    const q = query.trim().slice(0, MAX_SEARCH_QUERY_LEN);
    if (!q) return [];
    const db = this.supabase.forUser(token);
    return this.repo.searchAllMessages(db, q, 50);
  }

  // Status changes run through forUser, so RLS (conversations_access_update)
  // restricts callers to the application owner, the active assignee, or an
  // admin. A regular user setting 'resolved' is intentional (Scenario 18: user
  // marks issue resolved); broader status governance is a later-phase concern.
  async setStatus(
    token: string,
    applicationId: string,
    status: ConversationStatus,
  ): Promise<Conversation> {
    const db = this.supabase.forUser(token);
    const conversation = await this.ensureConversation(token, applicationId);
    const updated = await this.repo.setStatus(db, conversation.id, status);
    const recipients = await this.recipientIds(applicationId, null);
    this.bus.emit({
      type: 'conversation.status',
      conversation_id: conversation.id,
      application_id: applicationId,
      recipient_ids: recipients,
    });
    return updated;
  }

  /**
   * Set the consultant triage state on the conversation. Staff-only. Writes via
   * the service-role client because `conversations.consultant_state` is REVOKE'd
   * from `authenticated` (a user could otherwise set it via the conversations
   * owner UPDATE arm). Emits conversation.status so participants refetch.
   */
  async setConsultantState(
    token: string,
    caller: MessagingCaller,
    applicationId: string,
    state: ConsultantState,
  ): Promise<void> {
    if (caller.appRole !== 'consultant' && caller.appRole !== 'admin') {
      throw new ForbiddenException('Only consultants may set the case state');
    }
    const conversation = await this.ensureConversation(token, applicationId);
    await this.repo.setConsultantState(
      this.supabase.admin,
      conversation.id,
      state,
    );
    const recipients = await this.recipientIds(applicationId, null);
    this.bus.emit({
      type: 'conversation.status',
      conversation_id: conversation.id,
      application_id: applicationId,
      recipient_ids: recipients,
    });
  }

  emitTyping(
    conversationId: string,
    applicationId: string,
    recipientIds: string[],
  ): void {
    this.bus.emit({
      type: 'typing',
      conversation_id: conversationId,
      application_id: applicationId,
      recipient_ids: recipientIds,
    });
  }

  listNotifications(
    token: string,
    caller: MessagingCaller,
  ): Promise<AppNotification[]> {
    return this.repo.listNotifications(this.supabase.forUser(token), caller.id);
  }

  markNotificationsRead(token: string, caller: MessagingCaller): Promise<void> {
    return this.repo.markNotificationsRead(
      this.supabase.forUser(token),
      caller.id,
      new Date().toISOString(),
    );
  }

  /** Other parties on the application (excludes `excludeId` when given). */
  async recipientIds(
    applicationId: string,
    excludeId: string | null,
  ): Promise<string[]> {
    const parties = await this.repo.getApplicationParties(
      this.supabase.admin,
      applicationId,
    );
    return [parties.ownerId, ...parties.consultantIds].filter(
      (id): id is string => Boolean(id) && id !== excludeId,
    );
  }

  /**
   * Unread count for a recipient on an application, read via the service-role
   * client (background/notification path — no request token). Counts messages
   * from OTHER senders created after the recipient's read watermark. Returns 0
   * when no conversation exists yet.
   */
  async unreadCountForRecipient(
    applicationId: string,
    recipientId: string,
  ): Promise<number> {
    const db = this.supabase.admin;
    const conversation = await this.repo.getConversationByApplication(
      db,
      applicationId,
    );
    if (!conversation) return 0;
    const watermark = await this.repo.getLastRead(
      db,
      conversation.id,
      recipientId,
    );
    return this.repo.countUnread(db, conversation.id, recipientId, watermark);
  }
}
