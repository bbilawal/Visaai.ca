import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { safeLog } from '../shared/log/redact';
import { AdminUsersService } from './admin-users.service';
import { allAuthUsers } from './auth-user-pages';
import { canRemoveAdmin } from './user-admin-guards';

export type AppRole = 'admin' | 'consultant' | 'user';

function roleOf(appMetadata: unknown): AppRole {
  const r = (appMetadata as { role?: unknown } | undefined)?.role;
  return r === 'admin' || r === 'consultant' || r === 'user' ? r : 'user';
}

export interface AdminUserView {
  id: string;
  email: string;
  appRole: AppRole;
}

/**
 * Admin-only operations (system path → service-role client). Listing users and
 * mutating roles use the Supabase Admin Auth API; the role lives in app_metadata
 * (the RBAC source of truth read by JwtGuard). NEVER touches user_metadata.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly users: AdminUsersService,
  ) {}

  /**
   * All consultant users, for admin assignment pickers. Pages through the
   * GoTrue Admin Auth API (which returns ~50 users/page) so the picker is not
   * truncated, then filters to app_metadata.role === 'consultant'.
   */
  async listConsultants(): Promise<AdminUserView[]> {
    const out: AdminUserView[] = [];
    for (const u of await allAuthUsers(this.supabase.admin as never)) {
      if (roleOf(u.app_metadata) === 'consultant') {
        out.push({ id: u.id, email: u.email ?? '', appRole: 'consultant' });
      }
    }
    return out;
  }

  /**
   * ADMIN-003: the role-change path could orphan the platform.
   *
   * This wrote `app_metadata.role` with no guard at all, and two clicks in the
   * admin users table reach it (`UserRoleControl`, whose comment claimed "the
   * backend re-checks admin" — it did not). Demoting the last administrator, or
   * yourself, was allowed and is NOT recoverable from inside the product:
   * `JwtGuard.resolveAppRole` returns `app_metadata.role` whenever it holds a
   * valid value and only falls through to the `ADMIN_EMAILS` allow-list when it
   * is absent or invalid. So writing the perfectly valid `'user'` over an
   * admin — including an admin who only ever got in via ADMIN_EMAILS — shadows
   * the allow-list that would otherwise let them back in. Recovery means hand-
   * editing `auth.users.raw_app_meta_data` in the database.
   *
   * `canRemoveAdmin` already encodes the rule and the IAM revoke path already
   * calls it; this path simply never did. Same guard, same admin count, so the
   * two ways to remove an admin cannot disagree.
   */
  async setRole(
    userId: string,
    role: AppRole,
    actorId: string,
  ): Promise<AdminUserView> {
    if (role !== 'admin') {
      const { data: target, error: tErr } =
        await this.supabase.admin.auth.admin.getUserById(userId);
      if (tErr || !target?.user) throw new NotFoundException('user not found');
      const decision = canRemoveAdmin({
        actorId,
        targetId: userId,
        // isAdminUserById, not the sync predicate: an admin created through the
        // RBAC tables carries no app_metadata.role and need not be on the
        // ADMIN_EMAILS allow-list, so the grant has to be loaded. Missing it
        // here left exactly those admins demotable — and once 'user' is written
        // over them, JwtGuard short-circuits on that valid legacy role and
        // never reaches the grant that would let them back in.
        targetIsAdmin: await this.users.isAdminUserById(
          userId,
          target.user.email,
          target.user.app_metadata,
        ),
        adminCount: await this.users.adminCount(),
      });
      if (!decision.allowed) throw new ForbiddenException(decision.reason);
    }
    const { data, error } = await this.supabase.admin.auth.admin.updateUserById(
      userId,
      {
        app_metadata: { role },
      },
    );
    if (error || !data?.user)
      throw new Error(`setRole failed: ${error?.message ?? 'no user'}`);
    // Admin action audit — not application-scoped, so structured log (not the
    // per-application audit_events hash chain).
    safeLog.error(
      'admin',
      `role change: actor=${actorId} target=${userId} role=${role}`,
    );
    return { id: data.user.id, email: data.user.email ?? '', appRole: role };
  }

  async recentAuditLogs(
    applicationId: string | undefined,
    limit = 100,
  ): Promise<unknown[]> {
    let q = this.supabase.admin
      .from('audit_events')
      .select('*')
      // audit_events has no created_at; occurred_at is the server timestamp.
      .order('occurred_at', { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 500));
    if (applicationId) q = q.eq('application_id', applicationId);
    const { data, error } = await q;
    if (error) throw new Error(`recentAuditLogs failed: ${error.message}`);
    return (data ?? []) as unknown[];
  }
}
