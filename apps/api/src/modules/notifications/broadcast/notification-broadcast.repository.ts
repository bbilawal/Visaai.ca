import type { SupabaseClient } from '@supabase/supabase-js';
import type { BroadcastAudience, NotificationBroadcast } from '@visaai/types';

export interface CreateBroadcastRow {
  title: string;
  body: string;
  link: string | null;
  category: string;
  audience: BroadcastAudience;
  created_by: string | null;
}

export interface INotificationBroadcastRepository {
  create(
    db: SupabaseClient,
    row: CreateBroadcastRow,
  ): Promise<NotificationBroadcast>;
  getById(
    db: SupabaseClient,
    id: string,
  ): Promise<NotificationBroadcast | null>;
  list(
    db: SupabaseClient,
    cursor: string | null,
    limit: number,
  ): Promise<{ rows: NotificationBroadcast[]; nextCursor: string | null }>;
  markSent(
    db: SupabaseClient,
    id: string,
    recipientCount: number,
  ): Promise<void>;
  markFailed(db: SupabaseClient, id: string): Promise<void>;
}

export const NOTIFICATION_BROADCAST_REPOSITORY = Symbol(
  'INotificationBroadcastRepository',
);
