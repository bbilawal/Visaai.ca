import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationTemplate } from '@visaai/types';

export interface InsertTemplateRow {
  event_type: string;
  locale: string;
  subject: string | null;
  title: string;
  body: string;
  variables: string[];
  version: number;
  is_active: boolean;
  created_by: string | null;
}

export interface INotificationTemplateRepository {
  /** The active template for (event_type, locale), or null. */
  getActive(
    db: SupabaseClient,
    eventType: string,
    locale: string,
  ): Promise<NotificationTemplate | null>;
  /** All templates (optionally filtered), newest version first. */
  list(
    db: SupabaseClient,
    filter?: { eventType?: string; locale?: string },
  ): Promise<NotificationTemplate[]>;
  getById(db: SupabaseClient, id: string): Promise<NotificationTemplate | null>;
  insert(
    db: SupabaseClient,
    row: InsertTemplateRow,
  ): Promise<NotificationTemplate>;
  /** Deactivate the current active template for (event_type, locale), if any. */
  deactivateActive(
    db: SupabaseClient,
    eventType: string,
    locale: string,
  ): Promise<void>;
  deactivateById(db: SupabaseClient, id: string): Promise<void>;
  /** Highest version number seen for (event_type, locale); 0 if none. */
  maxVersion(
    db: SupabaseClient,
    eventType: string,
    locale: string,
  ): Promise<number>;
}

export const NOTIFICATION_TEMPLATE_REPOSITORY = Symbol(
  'INotificationTemplateRepository',
);
