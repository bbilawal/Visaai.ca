import { Injectable } from '@nestjs/common';
import type {
  NotificationCategory,
  NotificationFeedItem,
  NotificationFeedPage,
} from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';

/** Shape of a raw row returned by the notifications table query. */
interface NotificationRow {
  id: string;
  type: string;
  category: string;
  title: string | null;
  body: string | null;
  link: string | null;
  data: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
  conversation_id: string | null;
  message_id: string | null;
  // Embedded via the conversations FK so a message ping can deep-link the
  // thread. supabase-js infers a to-one embed as an array; accept either shape.
  conversations:
    | { application_id: string | null }
    | { application_id: string | null }[]
    | null;
}

/**
 * Map one raw row to a feed item. Message-ping rows — inserted by the messaging
 * module with a `message_id` and NULL `title`/`body` — are rendered as a
 * "New message" support notification that deep-links the conversation's thread
 * (`/messages/<applicationId>`, falling back to the messages list).
 */
function toFeedItem(row: NotificationRow): NotificationFeedItem {
  const isMessagePing = row.title === null && row.message_id !== null;
  if (isMessagePing) {
    const conv = Array.isArray(row.conversations)
      ? row.conversations[0]
      : row.conversations;
    const appId = conv?.application_id ?? null;
    return {
      id: row.id,
      type: row.type,
      category: 'support',
      title: 'New message',
      body: null,
      link: appId ? `/messages/${appId}` : '/messages',
      data: row.data ?? {},
      readAt: row.read_at,
      createdAt: row.created_at,
      conversationId: row.conversation_id,
      messageId: row.message_id,
    };
  }
  return {
    id: row.id,
    type: row.type,
    category: row.category as NotificationCategory,
    title: row.title,
    body: row.body,
    link: row.link,
    data: row.data ?? {},
    readAt: row.read_at,
    createdAt: row.created_at,
    conversationId: null,
    messageId: null,
  };
}

/**
 * Notification feed read-path — per-caller isolated (service-role writes,
 * always filtered by caller's user_id).
 *
 * All public methods filter by `userId` so a caller can NEVER read or mutate
 * another user's rows even though the underlying client uses service-role.
 */
@Injectable()
export class NotificationFeedService {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Returns a cursor-paginated page of notifications for `userId`.
   *
   * Keyset: `created_at DESC`, cursor = the `created_at` value of the last item
   * on the previous page.  Fetches `limit + 1` rows so we can detect whether
   * there is a next page without a separate count query.
   */
  async list(
    token: string,
    userId: string,
    cursor: string | null,
    limit = 20,
  ): Promise<NotificationFeedPage> {
    // RLS backstop: read as the caller (anon key + caller token). The explicit
    // `.eq('user_id', userId)` filter stays as defense-in-depth.
    const db = this.supabase.forUser(token);

    // Build the ordered, user-filtered base — lt() is applied before limit()
    // so TypeScript sees it on PostgrestFilterBuilder (returned by order/eq).
    const ordered = db
      .from('notifications')
      .select(
        'id, type, category, title, body, link, data, read_at, created_at, conversation_id, message_id, conversations(application_id)',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    const paged = cursor
      ? ordered.lt('created_at', cursor).limit(limit + 1)
      : ordered.limit(limit + 1);

    const { data, error } = await paged;
    if (error) throw error;

    const rows = (data as NotificationRow[]) ?? [];

    // Peek-ahead: if we got limit+1 rows the extra one tells us the next cursor.
    let nextCursor: string | null = null;
    if (rows.length > limit) {
      const extra = rows.pop()!;
      nextCursor = extra.created_at;
    }

    const items: NotificationFeedItem[] = rows.map(toFeedItem);

    const unread = await this.unreadCount(token, userId);

    return { rows: items, unread, nextCursor };
  }

  /** Count of unread notifications for `userId`. */
  async unreadCount(token: string, userId: string): Promise<number> {
    const { count, error } = await this.supabase
      .forUser(token)
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null);
    if (error) throw error;
    return count ?? 0;
  }

  /**
   * Mark a single notification as read.
   *
   * OWN-ROWS-ONLY: the update requires BOTH `id = id` AND `user_id = userId`.
   * A caller can never mark a row that belongs to another user — even with a
   * service-role client — because both conditions must match for any row to be
   * updated.
   */
  async markRead(
    token: string,
    userId: string,
    id: string,
  ): Promise<{ ok: true }> {
    const { error } = await this.supabase
      .forUser(token)
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
    return { ok: true };
  }

  /** Mark all unread notifications for `userId` as read in a single UPDATE. */
  async markAllRead(token: string, userId: string): Promise<{ ok: true }> {
    const { error } = await this.supabase
      .forUser(token)
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('read_at', null);
    if (error) throw error;
    return { ok: true };
  }
}
