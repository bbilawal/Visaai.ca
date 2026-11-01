import { Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationBroadcast } from '@visaai/types';
import {
  type CreateBroadcastRow,
  type INotificationBroadcastRepository,
} from './notification-broadcast.repository';

const COLS =
  'id, title, body, link, category, audience, status, recipient_count, created_at, completed_at';

@Injectable()
export class NotificationBroadcastRepository implements INotificationBroadcastRepository {
  async create(
    db: SupabaseClient,
    row: CreateBroadcastRow,
  ): Promise<NotificationBroadcast> {
    const { data, error } = await db
      .from('notification_broadcasts')
      .insert({ ...row, status: 'sending' })
      .select(COLS)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async getById(
    db: SupabaseClient,
    id: string,
  ): Promise<NotificationBroadcast | null> {
    const { data, error } = await db
      .from('notification_broadcasts')
      .select(COLS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ?? null;
  }

  async list(
    db: SupabaseClient,
    cursor: string | null,
    limit: number,
  ): Promise<{ rows: NotificationBroadcast[]; nextCursor: string | null }> {
    const lim = Math.min(Math.max(limit, 1), 100);
    let q = db
      .from('notification_broadcasts')
      .select(COLS)
      .order('created_at', { ascending: false });
    if (cursor) q = q.lt('created_at', cursor);
    const { data, error } = await q.limit(lim + 1);
    if (error) throw new Error(error.message);
    const all = (data ?? []) as NotificationBroadcast[];
    const hasMore = all.length > lim;
    const rows = hasMore ? all.slice(0, lim) : all;
    return {
      rows,
      nextCursor: hasMore ? rows[rows.length - 1].created_at : null,
    };
  }

  async markSent(
    db: SupabaseClient,
    id: string,
    recipientCount: number,
  ): Promise<void> {
    const { error } = await db
      .from('notification_broadcasts')
      .update({
        status: 'sent',
        recipient_count: recipientCount,
        completed_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async markFailed(db: SupabaseClient, id: string): Promise<void> {
    const { error } = await db
      .from('notification_broadcasts')
      .update({ status: 'failed', completed_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }
}
