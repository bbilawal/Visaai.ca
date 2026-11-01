import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../shared/supabase/supabase.service';
import {
  countPlatformAdmins,
  hasRbacAdminGrantFor,
  resolveAdminEmails,
  type AdminDirectory,
  type RoleGrantReader,
} from '../admin/admin-recipients';
import { isPlatformAdmin } from '../admin/user-admin-guards';

const DOCUMENTS_BUCKET = 'documents';

export interface DataExport {
  exportedAt: string;
  userId: string;
  profile: unknown;
  /** `user_profiles` — the expanded profile, distinct from the `users` row. */
  extendedProfile: unknown;
  applications: unknown[];
  checklistItems: unknown[];
  documents: unknown[];
  generatedDocuments: unknown[];
  vriScores: unknown[];
  payments: unknown[];
  subscriptions: unknown[];
  // PRIV-003: the subject's own words. Omitting these made the export
  // incomplete under GDPR Art. 15/20 in the categories that matter most.
  messages: unknown[];
  voiceSessions: unknown[];
  voiceTranscripts: unknown[];
  notifications: unknown[];
  notificationPreferences: unknown[];
  consultations: unknown[];
  loginHistory: unknown[];
  // PERF-005: `application_activity` was in this bundle and is NOT here now.
  // It is a derived VIEW returning only (application_id, user_id,
  // last_active_at) — a GREATEST() over timestamps from applications,
  // documents, generated_documents, vri_scores, submission_sessions and
  // application_profiles, every one of which the export already contains. It
  // added no personal data the subject did not already receive, and it cost
  // 1,136 ms of a 1,207 ms export: PostgREST parameterises the filter, the
  // generic plan re-evaluates the `applications` RLS policy as a SubPlan for
  // each joined table, and the whole thing runs ~300x slower than the same
  // query with a literal (495 ms vs 3.7 ms measured).
}

/**
 * GDPR Art. 17 (erasure) / Art. 20 (portability) + PIPEDA.
 *
 * Export runs on the caller's RLS-scoped client, so a user can only ever export
 * their own rows. Erasure runs on the service-role client because it deletes the
 * Supabase auth identity + storage objects; because `public.users.id references
 * auth.users on delete cascade`, deleting the auth user cascades through every
 * user-owned table (applications → children, payments, iam, messaging, …).
 * Rows referenced with ON DELETE SET NULL (analytics/ai-usage/audit "by" fields)
 * are anonymised rather than removed — the correct GDPR outcome for records that
 * must survive for financial/audit integrity.
 */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger('Privacy');

  constructor(private readonly supabase: SupabaseService) {}

  /** Portability export — reads only the caller's own rows via their RLS client. */
  async exportData(
    db: SupabaseClient,
    userId: string,
    email: string,
  ): Promise<DataExport> {
    try {
      return await this.collectExport(db, userId, email);
    } catch (err) {
      // Record the failure against the live user id — the subject still exists,
      // unlike the erasure path (PRIV-002). Without this, a failed export
      // leaves no trace at all.
      await this.record(userId, email, 'export', 'failed', {
        error: err instanceof Error ? err.message : 'unknown',
      });
      throw err;
    }
  }

  private async collectExport(
    db: SupabaseClient,
    userId: string,
    email: string,
  ): Promise<DataExport> {
    const profile = await this.rows(
      db.from('users').select('*').eq('id', userId),
    );
    const applications = await this.rows(
      db.from('applications').select('*').eq('user_id', userId),
    );
    const appIds = applications
      .map((a) => (a as { id?: string }).id)
      .filter((id): id is string => typeof id === 'string');

    const byApp = (table: string) =>
      appIds.length
        ? this.rows(db.from(table).select('*').in('application_id', appIds))
        : Promise.resolve([]);

    const byUser = (table: string) =>
      this.rows(db.from(table).select('*').eq('user_id', userId));

    // PRIV-003: the export used to stop at seven categories, omitting personal
    // data the subject is plainly entitled to under GDPR Art. 15/20 — most
    // conspicuously their own MESSAGES and VOICE TRANSCRIPTS, which are a
    // record of the person speaking. "Everything except the parts you said out
    // loud" is not a data export.
    //
    // Every read below runs on the caller's RLS-scoped client, so the export
    // can only ever contain rows the subject may already see.
    const conversationIds = appIds.length
      ? (
          await this.rows(
            db.from('conversations').select('id').in('application_id', appIds),
          )
        )
          .map((c) => (c as { id?: string }).id)
          .filter((id): id is string => typeof id === 'string')
      : [];

    const [
      checklistItems,
      documents,
      generatedDocuments,
      vriScores,
      payments,
      extendedProfile,
      messages,
      notifications,
      notificationPreferences,
      voiceSessions,
      voiceTranscripts,
      consultations,
      subscriptions,
      loginHistory,
    ] = await Promise.all([
      byApp('checklist_items'),
      byApp('documents'),
      byApp('generated_documents'),
      byApp('vri_scores'),
      byUser('payments'),
      byUser('user_profiles'),
      conversationIds.length
        ? this.rows(
            db
              .from('messages')
              .select('*')
              .in('conversation_id', conversationIds),
          )
        : Promise.resolve([]),
      byUser('notifications'),
      byUser('notification_preferences'),
      byUser('voice_sessions'),
      byUser('voice_transcript_turns'),
      byUser('consultations'),
      byUser('subscriptions'),
      byUser('login_history'),
    ]);

    await this.record(userId, email, 'export', 'completed', {
      applications: applications.length,
    });

    return {
      exportedAt: new Date().toISOString(),
      userId,
      profile: profile[0] ?? null,
      extendedProfile: extendedProfile[0] ?? null,
      applications,
      checklistItems,
      documents,
      generatedDocuments,
      vriScores,
      payments,
      subscriptions,
      messages,
      notifications,
      notificationPreferences,
      voiceSessions,
      voiceTranscripts,
      consultations,
      loginHistory,
    };
  }

  /**
   * The platform must keep an administrator.
   *
   * This endpoint is self-service (`JwtGuard` only — no `RolesGuard`) and hard-
   * deletes the auth identity, which cascades the database. It is the most
   * severe of the privilege-removal paths and was the only one with no
   * last-admin check: the sole administrator could erase themselves, and unlike
   * a soft-delete or a role change there is nothing left to restore.
   *
   * Deliberately NOT `canRemoveAdmin`, which refuses self-removal outright.
   * Erasure is a legal right under GDPR Art. 17, so an admin may absolutely
   * delete their own account — as long as they are not the last one. The
   * message says how to proceed rather than just refusing.
   */
  private async assertNotLastAdmin(
    userId: string,
    email: string,
  ): Promise<void> {
    const db = this.supabase.admin;
    const { data, error } = await db.auth.admin.getUserById(userId);
    if (error || !data?.user) return; // Nothing to protect; the delete will fail on its own.
    const adminEmails = resolveAdminEmails();
    const raw = (data.user.app_metadata as { role?: unknown } | undefined)
      ?.role;
    const rbacGrant =
      raw === 'admin' || raw === 'consultant' || raw === 'user'
        ? false // metadata short-circuits at the gate, so the grant is unreachable
        : await hasRbacAdminGrantFor(db as unknown as RoleGrantReader, userId);
    if (
      !isPlatformAdmin(
        data.user.email ?? email,
        data.user.app_metadata,
        adminEmails,
        rbacGrant,
      )
    )
      return;
    const admins = await countPlatformAdmins(
      db as unknown as AdminDirectory,
      adminEmails,
    );
    if (admins <= 1)
      throw new ForbiddenException(
        'You are the last platform administrator. Grant the admin role to ' +
          'someone else before deleting your account.',
      );
  }

  /**
   * Irreversible erasure. Records the request first (retained), removes storage
   * objects, then deletes the auth identity (cascades the database).
   */
  async deleteAccount(
    userId: string,
    email: string,
  ): Promise<{ deleted: true; storageRemoved: number }> {
    await this.assertNotLastAdmin(userId, email);
    const storageRemoved = await this.purgeStorage(userId);

    const { error } = await this.supabase.admin.auth.admin.deleteUser(userId);
    if (error) {
      await this.record(userId, email, 'deletion', 'failed', {
        error: error.message,
        storageRemoved,
      });
      throw new Error(`Account deletion failed: ${error.message}`);
    }

    // PRIV-002: record with user_id NULL, not `userId`.
    //
    // The FK is `ON DELETE SET NULL`, which rewrites rows that already exist
    // when the user goes away — it cannot rescue an INSERT that names a user
    // already deleted. Passing `userId` here produced a foreign-key violation
    // on every erasure, and `record()` only warned, so the audit row was
    // silently dropped. Verified live: after a successful deletion,
    // privacy_requests contained the export but not the erasure.
    //
    // NULL is the correct end state the FK was designed to produce anyway;
    // `subject_email` is what identifies the request once the user is gone.
    await this.record(null, email, 'deletion', 'completed', { storageRemoved });
    this.logger.log(
      `erased account ${userId} (${storageRemoved} storage objects)`,
    );
    return { deleted: true, storageRemoved };
  }

  /** Best-effort recursive delete of the user's document objects (`<userId>/…`). */
  private async purgeStorage(userId: string): Promise<number> {
    const store = this.supabase.admin.storage.from(DOCUMENTS_BUCKET);
    const paths: string[] = [];
    try {
      // SEC-12003: recurse the whole prefix tree. The old two-level walk missed
      // message and voice attachments, which live deeper at
      // `userId/appId/messages/conversationId/<file>` — identity documents
      // exchanged in consultant messaging survived "erasure". A folder entry
      // reports null metadata; a file reports metadata. Depth is capped defensively.
      const collect = async (prefix: string, depth: number): Promise<void> => {
        if (depth > 8) return;
        const { data: entries } = await store.list(prefix, { limit: 1000 });
        for (const entry of entries ?? []) {
          const full = `${prefix}/${entry.name}`;
          const isFile =
            (entry as { metadata?: unknown; id?: unknown }).metadata != null ||
            (entry as { id?: unknown }).id != null;
          if (isFile) paths.push(full);
          else await collect(full, depth + 1);
        }
      };
      await collect(userId, 0);

      // Supabase remove() takes a bounded list; chunk to be safe on large accounts.
      for (let i = 0; i < paths.length; i += 100) {
        const chunk = paths.slice(i, i + 100);
        const { error } = await store.remove(chunk);
        if (error) this.logger.warn(`storage purge partial: ${error.message}`);
      }
    } catch (e) {
      this.logger.warn(
        `storage purge failed for ${userId}: ${(e as Error).message}`,
      );
    }
    return paths.length;
  }

  /**
   * `userId` is null once the subject has been erased — see PRIV-002.
   *
   * A failure here is logged at ERROR, not warn. This row IS the evidence that
   * a data-subject request was honoured; losing it silently is the difference
   * between "we complied" and "we cannot show that we complied", which is the
   * only version a regulator sees.
   */
  private async record(
    userId: string | null,
    email: string,
    kind: 'export' | 'deletion',
    status: 'completed' | 'failed',
    details: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await this.supabase.admin
      .from('privacy_requests')
      .insert({ user_id: userId, subject_email: email, kind, status, details });
    if (error) {
      this.logger.error(
        `privacy_requests insert FAILED for a ${kind} request (${email}): ${error.message}. ` +
          `The request was carried out but there is now no audit record of it.`,
      );
    }
  }

  /**
   * One category of the portability export.
   *
   * PRIV-004: this dropped `error` and returned `[]`. supabase-js resolves a
   * failed read as `{ data: null, error }` rather than rejecting, so a failed
   * category was indistinguishable from an empty one — and `exportData` went on
   * to record the request `completed`. A data subject could receive a bundle
   * silently missing their documents, messages or payments, with the audit
   * trail asserting the request was honoured in full. Under GDPR Art. 15/20
   * that is the worst of both: an incomplete disclosure AND a false record of
   * compliance.
   *
   * Throwing aborts the export, so the caller records `failed` and the subject
   * is told to retry rather than handed a bundle they will believe is complete.
   */
  private async rows(
    query: PromiseLike<{ data: unknown[] | null; error?: unknown }>,
  ): Promise<unknown[]> {
    const { data, error } = await query;
    if (error) {
      const message =
        typeof error === 'object' && error !== null && 'message' in error
          ? String(error.message)
          : String(error);
      throw new Error(`export category read failed: ${message}`);
    }
    return data ?? [];
  }
}
