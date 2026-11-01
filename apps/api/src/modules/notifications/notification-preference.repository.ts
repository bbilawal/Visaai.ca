import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationPreferences } from '@visaai/types';

export type NotificationPreferencePatch = {
  email_enabled?: boolean;
  push_enabled?: boolean;
  sms_enabled?: boolean;
  categories?: Record<string, boolean>;
  quiet_hours_start?: number | null;
  quiet_hours_end?: number | null;
  timezone?: string | null;
  language?: string | null;
};

export interface INotificationPreferenceRepository {
  /** Returns the row, or an in-memory all-enabled default when none exists. */
  getForUser(
    db: SupabaseClient,
    userId: string,
  ): Promise<NotificationPreferences>;
  upsert(
    db: SupabaseClient,
    userId: string,
    patch: NotificationPreferencePatch,
  ): Promise<NotificationPreferences>;
  /** Service-role: force-disable email (unsubscribe link). */
  disableEmail(db: SupabaseClient, userId: string): Promise<void>;
}

export const NOTIFICATION_PREFERENCE_REPOSITORY = Symbol(
  'INotificationPreferenceRepository',
);
