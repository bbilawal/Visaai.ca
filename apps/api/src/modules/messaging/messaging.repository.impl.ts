import { Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AppNotification,
  Conversation,
  ConversationParticipant,
  ConversationStatus,
  GlobalMessageSearchResult,
  Message,
} from '@visaai/types';
import {
  type IMessagingRepository,
  type InsertMessageInput,
  type NotificationInsert,
} from './messaging.repository';

function unwrap<T>(res: { data: unknown; error: unknown }, ctx: string): T {
  if (res.error) {
    throw new Error((res.error as { message?: string }).message ?? ctx);
  }
  return res.data as T;
}

@Injectable()
export class MessagingRepository implements IMessagingRepository {
  async getConversationByApplication(
    db: SupabaseClient,
    applicationId: string,
  ): Promise<Conversation | null> {
    const res = await db
      .from('conversations')
      .select('*')
      .eq('application_id', applicationId)
      .maybeSingle();
    if (res.error) throw new Error(res.error.message);
    return (res.data as Conversation) ?? null;
  }

  async insertConversation(
    db: SupabaseClient,
    applicationId: string,
  ): Promise<Conversation> {
    const res = await db
      .from('conversations')
      .insert({ application_id: applicationId })
      .select('*')
      .single();
    if (res.error) {
      // Lost a concurrent get-or-create race: a sibling request created the
      // conversation between our caller's SELECT and this INSERT. UNIQUE
      // (application_id) rejects the duplicate (Postgres 23505) — re-read and
      // return the winner's row. The caller can see it: the same RLS predicate
      // (owner OR active assignee) authorized this very INSERT.
      if ((res.error as { code?: string }).code === '23505') {
        const existing = await this.getConversationByApplication(
          db,
          applicationId,
        );
        if (existing) return existing;
      }
      throw new Error(res.error.message);
    }
    return res.data as Conversation;
  }

  async listMessages(
    db: SupabaseClient,
    conversationId: string,
  ): Promise<Message[]> {
    const res = await db
      .from('messages')
      .select('*, message_attachments(*), voice_messages(*)')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (res.error) throw new Error(res.error.message);
    return (res.data as Message[]) ?? [];
  }

  async listMessagesPage(
    db: SupabaseClient,
    conversationId: string,
    limit: number,
    before: string | null,
  ): Promise<Message[]> {
    let q = db
      .from('messages')
      .select('*, message_attachments(*), voice_messages(*)')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (before) q = q.lt('created_at', before);
    const res = await q;
    if (res.error) throw new Error(res.error.message);
    return (res.data as Message[]) ?? [];
  }

  async insertMessage(
    db: SupabaseClient,
    input: InsertMessageInput,
  ): Promise<Message> {
    const res = await db
      .from('messages')
      .insert({
        conversation_id: input.conversationId,
        sender_id: input.senderId,
        sender_role: input.senderRole,
        category: input.category,
        body: input.body,
        parent_message_id: input.parentMessageId,
        client_id: input.clientId ?? null,
      })
      .select('*')
      .single();
    return unwrap<Message>(res, 'insertMessage');
  }

  async findByClientId(
    db: SupabaseClient,
    conversationId: string,
    senderId: string,
    clientId: string,
  ): Promise<Message | null> {
    const res = await db
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('sender_id', senderId)
      .eq('client_id', clientId)
      .maybeSingle();
    if (res.error) throw new Error(res.error.message);
    return (res.data as Message | null) ?? null;
  }

  async touchLastMessageAt(
    db: SupabaseClient,
    conversationId: string,
    at: string,
  ): Promise<void> {
    const res = await db
      .from('conversations')
      .update({ last_message_at: at })
      .eq('id', conversationId);
    if (res.error) throw new Error(res.error.message);
  }

  async setStatus(
    db: SupabaseClient,
    conversationId: string,
    status: ConversationStatus,
  ): Promise<Conversation> {
    const res = await db
      .from('conversations')
      .update({ status })
      .eq('id', conversationId)
      .select('*')
      .single();
    return unwrap<Conversation>(res, 'setStatus');
  }

  async setConsultantState(
    db: SupabaseClient,
    conversationId: string,
    state: import('@visaai/types').ConsultantState,
  ): Promise<void> {
    const res = await db
      .from('conversations')
      .update({ consultant_state: state })
      .eq('id', conversationId);
    if (res.error) throw new Error(res.error.message);
  }

  async advanceLastRead(
    db: SupabaseClient,
    conversationId: string,
    userId: string,
    at: string,
  ): Promise<void> {
    const res = await db
      .from('conversation_participants')
      .update({ last_read_at: at })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);
    if (res.error) throw new Error(res.error.message);
  }

  async advanceDelivered(
    admin: SupabaseClient,
    conversationId: string,
    userIds: string[],
    at: string,
  ): Promise<void> {
    if (userIds.length === 0) return; // nothing online → no write
    const res = await admin
      .from('conversation_participants')
      .update({ delivered_at: at })
      .eq('conversation_id', conversationId)
      .in('user_id', userIds);
    if (res.error) throw new Error(res.error.message);
  }

  async advanceDeliveredForUser(
    admin: SupabaseClient,
    userId: string,
    at: string,
  ): Promise<void> {
    const res = await admin
      .from('conversation_participants')
      .update({ delivered_at: at })
      .eq('user_id', userId);
    if (res.error) throw new Error(res.error.message);
  }

  async getLastRead(
    db: SupabaseClient,
    conversationId: string,
    userId: string,
  ): Promise<string | null> {
    const res = await db
      .from('conversation_participants')
      .select('last_read_at')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .maybeSingle();
    if (res.error) throw new Error(res.error.message);
    return res.data?.last_read_at ?? null;
  }

  async countUnread(
    db: SupabaseClient,
    conversationId: string,
    recipientId: string,
    watermark: string | null,
  ): Promise<number> {
    let q = db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .neq('sender_id', recipientId);
    if (watermark) q = q.gt('created_at', watermark);
    const res = await q;
    if (res.error) throw new Error(res.error.message);
    return res.count ?? 0;
  }

  async listNotifications(
    db: SupabaseClient,
    userId: string,
  ): Promise<AppNotification[]> {
    const res = await db
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (res.error) throw new Error(res.error.message);
    return (res.data as AppNotification[]) ?? [];
  }

  async markNotificationsRead(
    db: SupabaseClient,
    userId: string,
    at: string,
  ): Promise<void> {
    const res = await db
      .from('notifications')
      .update({ read_at: at })
      .eq('user_id', userId)
      .is('read_at', null);
    if (res.error) throw new Error(res.error.message);
  }

  async upsertParticipant(
    admin: SupabaseClient,
    conversationId: string,
    userId: string,
    role: 'user' | 'consultant' | 'admin',
  ): Promise<void> {
    const res = await admin
      .from('conversation_participants')
      .upsert(
        { conversation_id: conversationId, user_id: userId, role },
        { onConflict: 'conversation_id,user_id' },
      );
    if (res.error) throw new Error(res.error.message);
  }

  async insertNotifications(
    admin: SupabaseClient,
    rows: NotificationInsert[],
  ): Promise<void> {
    if (rows.length === 0) return;
    const res = await admin.from('notifications').insert(
      rows.map((r) => ({
        user_id: r.userId,
        type: r.type,
        conversation_id: r.conversationId,
        message_id: r.messageId,
      })),
    );
    if (res.error) throw new Error(res.error.message);
  }

  async getApplicationParties(
    admin: SupabaseClient,
    applicationId: string,
  ): Promise<{ ownerId: string | null; consultantIds: string[] }> {
    const appRes = await admin
      .from('applications')
      .select('user_id')
      .eq('id', applicationId)
      .maybeSingle();
    if (appRes.error) throw new Error(appRes.error.message);
    const assignRes = await admin
      .from('consultant_assignments')
      .select('consultant_id')
      .eq('application_id', applicationId)
      .eq('status', 'active');
    if (assignRes.error) throw new Error(assignRes.error.message);
    return {
      ownerId: (appRes.data as { user_id?: string } | null)?.user_id ?? null,
      consultantIds: (
        (assignRes.data as { consultant_id: string }[] | null) ?? []
      ).map((r) => r.consultant_id),
    };
  }

  async listParticipants(
    admin: SupabaseClient,
    conversationId: string,
  ): Promise<ConversationParticipant[]> {
    const res = await admin
      .from('conversation_participants')
      .select('*')
      .eq('conversation_id', conversationId);
    if (res.error) throw new Error(res.error.message);
    return (res.data as ConversationParticipant[]) ?? [];
  }

  async searchMessages(
    db: SupabaseClient,
    conversationId: string,
    query: string,
    limit: number,
  ): Promise<Message[]> {
    const res = await db
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .textSearch('search_tsv', query, { type: 'websearch', config: 'simple' })
      .order('created_at', { ascending: false })
      .limit(limit);
    if (res.error) throw new Error(res.error.message);
    return (res.data as Message[]) ?? [];
  }

  async searchAllMessages(
    db: SupabaseClient,
    query: string,
    limit: number,
  ): Promise<GlobalMessageSearchResult[]> {
    const res = await db
      .from('messages')
      .select(
        'id, conversation_id, sender_role, category, body, created_at, ' +
          'conversations!inner(application_id, ' +
          'applications!inner(country_frameworks(country_code, visa_type)))',
      )
      .textSearch('search_tsv', query, { type: 'websearch', config: 'simple' })
      .order('created_at', { ascending: false })
      .limit(limit);
    if (res.error) throw new Error(res.error.message);

    // PostgREST returns to-one embeds as objects, but defend against arrays too.
    const one = (v: unknown): Record<string, unknown> | null =>
      ((Array.isArray(v) ? v[0] : v) as Record<string, unknown> | null) ?? null;

    return ((res.data as unknown as Record<string, unknown>[]) ?? []).flatMap(
      (r): GlobalMessageSearchResult[] => {
        const conv = one(r.conversations);
        const application_id = conv?.['application_id'] as string | undefined;
        // conversations!inner + NOT NULL FK guarantee this is present; skip
        // defensively so a result never carries a fake/empty application_id
        // (the type promises string).
        if (!application_id) return [];
        const app = one(conv?.['applications']);
        const fw = one(app?.['country_frameworks']);
        return [
          {
            id: r.id as string,
            conversation_id: r.conversation_id as string,
            application_id,
            category: r.category as GlobalMessageSearchResult['category'],
            sender_role:
              r.sender_role as GlobalMessageSearchResult['sender_role'],
            body: r.body as string,
            created_at: r.created_at as string,
            country_code: (fw?.['country_code'] as string) ?? null,
            visa_type: (fw?.['visa_type'] as string) ?? null,
          },
        ];
      },
    );
  }
}
