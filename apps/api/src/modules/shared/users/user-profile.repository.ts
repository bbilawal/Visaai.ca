import { Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * ARCH-005: the `users` table was being read and written straight from three
 * controllers (`visa`, `me`, `reminders`), putting HTTP handling and persistence
 * in the same file. All of them used the request-scoped client, so RLS still
 * applied — but it was the one seam where an RLS mistake would not be caught by
 * a repository test.
 *
 * Every method takes the caller's RLS-scoped client explicitly, EXCEPT
 * `disableEmailReminders`, which is reached from an unauthenticated
 * one-click unsubscribe link and therefore has no user session to scope to.
 * That asymmetry is the point of putting these in one place: it is now visible
 * rather than buried in a controller.
 */
@Injectable()
export class UserProfileRepository {
  constructor(private readonly supabase: SupabaseService) {}

  /** Best-effort: returns null on any error or unset preference. */
  async getPreferredLanguage(
    db: SupabaseClient,
    userId: string,
  ): Promise<string | null> {
    try {
      const { data } = await db
        .from('users')
        .select('preferred_language')
        .eq('id', userId)
        .single();
      return (
        (data as { preferred_language?: string | null } | null)
          ?.preferred_language ?? null
      );
    } catch {
      return null;
    }
  }

  /** Returns false when the write fails; the caller decides how to surface it. */
  async setPreferredLanguage(
    db: SupabaseClient,
    userId: string,
    language: string,
  ): Promise<boolean> {
    const { error } = await db
      .from('users')
      .update({ preferred_language: language })
      .eq('id', userId);
    return !error;
  }

  async getCreatedAt(
    db: SupabaseClient,
    userId: string,
  ): Promise<string | null> {
    const { data } = await db
      .from('users')
      .select('created_at')
      .eq('id', userId)
      .maybeSingle();
    return (data as { created_at?: string } | null)?.created_at ?? null;
  }

  /**
   * Service-role by necessity: the unsubscribe link is followed from an email
   * client with no session. Authorisation is the HMAC token the caller verifies
   * BEFORE reaching this method — never call it on an unverified userId.
   */
  async disableEmailReminders(userId: string): Promise<void> {
    await this.supabase.admin
      .from('users')
      .update({ email_reminders: false })
      .eq('id', userId);
  }
}
