import { Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationPreferences } from '@visaai/types';
import { type INotificationPreferenceRepository } from './notification-preference.repository';

function defaults(userId: string): NotificationPreferences {
  return {
    user_id: userId,
    email_enabled: true,
    push_enabled: true,
    sms_enabled: false,
    categories: {},
    quiet_hours_start: null,
    quiet_hours_end: null,
    timezone: null,
    language: null,
    updated_at: new Date(0).toISOString(),
  };
}

@Injectable()
export class NotificationPreferenceRepository implements INotificationPreferenceRepository {
  async getForUser(
    db: SupabaseClient,
    userId: string,
  ): Promise<NotificationPreferences> {
    const res = await db
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (res.error) throw new Error(res.error.message);
    return (res.data as NotificationPreferences) ?? defaults(userId);
  }

  async upsert(
    db: SupabaseClient,
    userId: string,
    patch: {
      email_enabled?: boolean;
      push_enabled?: boolean;
      categories?: Record<string, boolean>;
      quiet_hours_start?: number | null;
      quiet_hours_end?: number | null;
      timezone?: string | null;
      language?: string | null;
    },
  ): Promise<NotificationPreferences> {
    const res = await db
      .from('notification_preferences')
      .upsert(
        { user_id: userId, ...patch, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      )
      .select('*')
      .single();
    if (res.error) throw new Error(res.error.message);
    return res.data as NotificationPreferences;
  }

  async disableEmail(db: SupabaseClient, userId: string): Promise<void> {
    const res = await db.from('notification_preferences').upsert(
      {
        user_id: userId,
        email_enabled: false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
    if (res.error) throw new Error(res.error.message);
  }
}
