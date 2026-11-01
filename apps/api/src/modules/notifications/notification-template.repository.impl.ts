import { Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationTemplate } from '@visaai/types';
import {
  type INotificationTemplateRepository,
  type InsertTemplateRow,
} from './notification-template.repository';

const COLS =
  'id, event_type, locale, subject, title, body, variables, version, is_active, created_at';

@Injectable()
export class NotificationTemplateRepository implements INotificationTemplateRepository {
  async getActive(
    db: SupabaseClient,
    eventType: string,
    locale: string,
  ): Promise<NotificationTemplate | null> {
    const { data, error } = await db
      .from('notification_templates')
      .select(COLS)
      .eq('event_type', eventType)
      .eq('locale', locale)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ?? null;
  }

  async list(
    db: SupabaseClient,
    filter?: { eventType?: string; locale?: string },
  ): Promise<NotificationTemplate[]> {
    let q = db.from('notification_templates').select(COLS);
    if (filter?.eventType) q = q.eq('event_type', filter.eventType);
    if (filter?.locale) q = q.eq('locale', filter.locale);
    const { data, error } = await q
      .order('event_type', { ascending: true })
      .order('locale', { ascending: true })
      .order('version', { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async getById(
    db: SupabaseClient,
    id: string,
  ): Promise<NotificationTemplate | null> {
    const { data, error } = await db
      .from('notification_templates')
      .select(COLS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ?? null;
  }

  async insert(
    db: SupabaseClient,
    row: InsertTemplateRow,
  ): Promise<NotificationTemplate> {
    const { data, error } = await db
      .from('notification_templates')
      .insert(row)
      .select(COLS)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async deactivateActive(
    db: SupabaseClient,
    eventType: string,
    locale: string,
  ): Promise<void> {
    const { error } = await db
      .from('notification_templates')
      .update({ is_active: false })
      .eq('event_type', eventType)
      .eq('locale', locale)
      .eq('is_active', true);
    if (error) throw new Error(error.message);
  }

  async deactivateById(db: SupabaseClient, id: string): Promise<void> {
    const { error } = await db
      .from('notification_templates')
      .update({ is_active: false })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async maxVersion(
    db: SupabaseClient,
    eventType: string,
    locale: string,
  ): Promise<number> {
    const { data, error } = await db
      .from('notification_templates')
      .select('version')
      .eq('event_type', eventType)
      .eq('locale', locale)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as { version?: number } | null)?.version ?? 0;
  }
}
