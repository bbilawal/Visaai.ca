import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../shared/supabase/supabase.service';
import {
  canLifecycle,
  isPlatformAdmin,
  planBulk,
  resolveAppRoleFor,
  type LifecycleAction,
  type GuardTarget,
} from './user-admin-guards';
import {
  countPlatformAdmins,
  hasRbacAdminGrantFor,
  type AdminDirectory,
  type RoleGrantReader,
} from './admin-recipients';
import type {
  UserStatus,
  AdminUserView,
  AdminUserDetail,
  AdminUserListResult,
  AuthAuditRow,
  BulkActionResult,
} from '@visaai/types';
import type { ListUsersV2Dto, BulkUsersDto } from './admin.dto';
import type { Env } from '../../config/configuration';
import { AnalyticsEventBus } from '../analytics/analytics-event-bus';
import { allAuthUsers } from './auth-user-pages';
import { makeServerEvent } from '../analytics/events/catalog';

type AppRole = 'admin' | 'consultant' | 'user';
function roleOf(meta: unknown): AppRole {
  const r = (meta as { role?: unknown } | undefined)?.role;
  return r === 'admin' || r === 'consultant' || r === 'user' ? r : 'user';
}

const BANNED = '876000h';
const UNBANNED = 'none';

@Injectable()
export class AdminUsersService {
  /**
   * The same env fallback `JwtGuard` resolves admins by.
   *
   * ADMIN-002: this service decided "is an admin" from `app_metadata.role`
   * ALONE, and that key is written for 1 of 50 production users — so nobody
   * read as an admin here. The last-admin guard in `user-admin-guards` only
   * runs `if (ctx.target.isAdmin)`, which meant the protection against removing
   * the platform's final administrator could not fire at all: dead code in
   * production, on the one path that exists to prevent locking everyone out.
   * `adminCount` was 0 for the same reason.
   *
   * JwtGuard has always honoured ADMIN_EMAILS as a fallback — that is how the
   * live admin actually gets in — so the two now agree on who is an admin.
   * Disagreeing about that between the gate and the guard is the bug.
   */
  private readonly adminEmails: Set<string>;

  constructor(
    private readonly supabase: SupabaseService,
    config: ConfigService<Env>,
    @Optional() private readonly analytics?: AnalyticsEventBus,
  ) {
    this.adminEmails = new Set(
      config.get('ADMIN_EMAILS', { infer: true }) ?? [],
    );
  }

  /**
   * Admin exactly as `JwtGuard` resolves it. `rbacAdminGrant` is the third
   * source and is NOT optional in spirit: a caller that passes nothing is
   * asserting it already knows the user holds no platform_admin/super_admin
   * grant. Use `isAdminUserById` when you do not know.
   */
  isAdminUser(
    email: string | null | undefined,
    meta: unknown,
    rbacAdminGrant = false,
  ): boolean {
    return isPlatformAdmin(email, meta, this.adminEmails, rbacAdminGrant);
  }

  /** Admin determination for one user, loading the RBAC grant itself. */
  async isAdminUserById(
    userId: string,
    email: string | null | undefined,
    meta: unknown,
  ): Promise<boolean> {
    // Skip the query when signed metadata already decides it — the guard
    // short-circuits there too, so the lookup could not change the answer.
    const raw = (meta as { role?: unknown } | undefined)?.role;
    if (raw === 'admin' || raw === 'consultant' || raw === 'user')
      return raw === 'admin';
    if (email && this.adminEmails.has(email.toLowerCase())) return true;
    return hasRbacAdminGrantFor(this.db as unknown as RoleGrantReader, userId);
  }
  private get db() {
    return this.supabase.admin;
  }

  private async loadTarget(
    userId: string,
  ): Promise<GuardTarget & { email: string }> {
    const { data: authRes, error: aErr } =
      await this.db.auth.admin.getUserById(userId);
    if (aErr || !authRes?.user) throw new NotFoundException('user not found');
    const { data: row, error: rErr } = await this.db
      .from('users')
      .select('status')
      .eq('id', userId)
      .single();
    if (rErr) throw rErr;
    const isAdmin = await this.isAdminUserById(
      userId,
      authRes.user.email,
      authRes.user.app_metadata,
    );
    return {
      id: userId,
      status: (row?.status ?? 'active') as UserStatus,
      isAdmin,
      email: authRes.user.email ?? '',
    };
  }

  /** Every auth user across all pages (see auth-user-pages: GoTrue caps pages at ~50). */
  private async allAuthUsers(): Promise<
    Array<{ id: string; email: string | null; app_metadata: unknown }>
  > {
    // `email` is carried because the admin fallback is keyed on it; dropping
    // it here is what left `adminCount` unable to see the live admin.
    return (await allAuthUsers(this.db as never)).map((u) => ({
      id: u.id,
      email: u.email ?? null,
      app_metadata: u.app_metadata,
    }));
  }

  /**
   * Active platform admins. Public because `AdminService.setRole` must gate the
   * role-change path on the SAME number the lifecycle guard uses — a second
   * implementation is how ADMIN-002 happened.
   */
  async adminCount(): Promise<number> {
    return countPlatformAdmins(
      this.db as unknown as AdminDirectory,
      this.adminEmails,
    );
  }

  private async audit(
    eventType: string,
    userId: string,
    actorId: string,
    reason?: string,
  ) {
    // Throw on a returned error — the audit log is part of the action's contract,
    // not best-effort (matches iam.repository.impl.ts). A silent audit failure
    // would leave a mutation with no system-of-record entry.
    const { error } = await this.db.from('auth_audit_log').insert({
      user_id: userId,
      actor_id: actorId,
      event_type: eventType,
      metadata: reason ? { reason } : {},
    });
    if (error) throw error;
  }

  private async apply(
    action: LifecycleAction,
    userId: string,
    actorId: string,
    reason: string | undefined,
  ) {
    const target = await this.loadTarget(userId);
    const decision = canLifecycle(action, {
      actorId,
      target,
      adminCount: await this.adminCount(),
    });
    if (!decision.allowed) throw new ForbiddenException(decision.reason);

    const removesAccess = action === 'suspend' || action === 'soft-delete';
    const newStatus: UserStatus =
      action === 'suspend'
        ? 'suspended'
        : action === 'soft-delete'
          ? 'deleted'
          : 'active';
    // Two-system write (auth ban + table). Errors are surfaced (thrown), but there
    // is no distributed transaction: if the table update fails after the ban
    // succeeds, the user is banned in auth while public.users.status is stale.
    // The auth ban is the real access control; re-running the action converges state.
    const { error: banErr } = await this.db.auth.admin.updateUserById(userId, {
      ban_duration: removesAccess ? BANNED : UNBANNED,
    });
    if (banErr) throw banErr;
    const { error: upErr } = await this.db
      .from('users')
      .update({
        status: newStatus,
        status_reason: reason ?? null,
        status_changed_at: new Date().toISOString(),
        status_changed_by: actorId,
      })
      .eq('id', userId);
    if (upErr) throw upErr;
    await this.audit(
      `user_${action.replace('-', '_')}`,
      userId,
      actorId,
      reason,
    );
    // Analytics: allowlisted non-PII fields only (action enum + ids — no email,
    // no reason free-text). Representative admin-mutation hook; other admin
    // actions (role change, bulk) are follow-ups — see task-13-report.md.
    this.analytics?.emitSafe(
      makeServerEvent('admin.action', {
        user_id: actorId,
        props: { action, target_type: 'user', target_user_id: userId },
      }),
    );
    return { id: userId, status: newStatus };
  }

  suspend(userId: string, actorId: string, reason?: string) {
    return this.apply('suspend', userId, actorId, reason);
  }
  reactivate(userId: string, actorId: string) {
    return this.apply('reactivate', userId, actorId, undefined);
  }
  softDelete(userId: string, actorId: string, reason?: string) {
    return this.apply('soft-delete', userId, actorId, reason);
  }
  restore(userId: string, actorId: string) {
    return this.apply('restore', userId, actorId, undefined);
  }

  async resetPassword(userId: string, actorId: string) {
    const target = await this.loadTarget(userId);
    if (!target.email) throw new NotFoundException('user has no email');
    // Don't issue recovery links for soft-deleted accounts (terminal state).
    // Suspended users keep the auth ban, which blocks login regardless of a
    // password change, so a reset there is harmless — restore them first if needed.
    if (target.status === 'deleted')
      throw new ForbiddenException(
        'cannot issue a password reset for a deleted account',
      );
    const { error } = await this.db.auth.admin.generateLink({
      type: 'recovery',
      email: target.email,
    });
    if (error) throw error;
    await this.audit('password_reset_issued', userId, actorId);
    return { issued: true };
  }

  // ---- read models (Task 4) ----

  /** IAM role keys per user id, for a bounded set of ids. */
  /**
   * Which of these users hold an ACTIVE consultant assignment — the last source
   * `JwtGuard.resolveAppRole` consults before defaulting to 'user'. Bounded by
   * the caller's page size, so this is one extra query, not one per row.
   */
  private async assignedConsultantIds(
    ids: string[],
  ): Promise<ReadonlySet<string>> {
    if (ids.length === 0) return new Set();
    const { data, error } = await this.db
      .from('consultant_assignments')
      .select('consultant_id')
      .eq('status', 'active')
      .in('consultant_id', ids);
    if (error) throw error;
    return new Set(
      (data ?? []).map((r: { consultant_id: string }) => r.consultant_id),
    );
  }

  private async rolesByUser(ids: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (ids.length === 0) return out;
    const { data, error } = await this.db
      .from('user_roles')
      .select('user_id, roles!inner(key)')
      .in('user_id', ids);
    if (error) throw error;
    for (const r of (data ?? []) as {
      user_id: string;
      roles: { key: string } | { key: string }[];
    }[]) {
      const key = Array.isArray(r.roles) ? r.roles[0]?.key : r.roles?.key;
      if (!key) continue;
      const list = out.get(r.user_id) ?? [];
      list.push(key);
      out.set(r.user_id, list);
    }
    return out;
  }

  async listUsers(params: ListUsersV2Dto): Promise<AdminUserListResult> {
    // If filtering by IAM role, resolve the matching user ids first.
    let roleFilterIds: string[] | null = null;
    if (params.role) {
      const { data: rr, error: re } = await this.db
        .from('user_roles')
        .select('user_id, roles!inner(key)')
        .eq('roles.key', params.role);
      if (re) throw re;
      roleFilterIds = [
        ...new Set((rr ?? []).map((r: { user_id: string }) => r.user_id)),
      ];
      if (roleFilterIds.length === 0) return { rows: [], total: 0 };
    }

    let query = this.db
      .from('users')
      .select('id,email,full_name,status,created_at', { count: 'exact' });
    // Registered accounts only, unless the caller asks for the guests too.
    // An anonymous identity has no email and a registered one always does
    // (signup is email/password or OAuth), so the column is the discriminator
    // and it needs no join onto `auth.users` — verified against the source of
    // truth on 2026-09-06: is_anonymous was true for exactly the rows with a
    // null email.
    if (!params.includeGuests) query = query.not('email', 'is', null);
    if (params.q) {
      const needle = params.q.replace(/[%,]/g, ' ');
      query = query.or(`email.ilike.%${needle}%,full_name.ilike.%${needle}%`);
    }
    if (params.status) query = query.eq('status', params.status);
    if (roleFilterIds) query = query.in('id', roleFilterIds);
    query =
      params.sort === 'email'
        ? query.order('email', { ascending: true })
        : query.order('created_at', { ascending: false });
    const from = (params.page - 1) * params.pageSize;
    query = query.range(from, from + params.pageSize - 1);

    const { data, count, error } = await query;
    if (error) throw error;
    const baseRows = (data ?? []) as {
      id: string;
      email: string;
      full_name: string | null;
      status: UserStatus;
      created_at: string;
    }[];
    const roleMap = await this.rolesByUser(baseRows.map((r) => r.id));

    // PERF-002: this used to await getUserById once per row, sequentially, so
    // one admin page load cost `pageSize` serial round-trips to the Auth API
    // (up to 100). `rolesByUser` above was already batched; this was not.
    // Bounded fan-out: pageSize is clamped to 100 by the DTO, so Promise.all
    // cannot become an unbounded burst.
    const authUsers = await Promise.all(
      baseRows.map(async (r) => {
        const { data: authRes } = await this.db.auth.admin.getUserById(r.id);
        return authRes?.user;
      }),
    );

    // The role shown must be the role the gate will actually grant. Reading
    // `app_metadata.role` alone listed every ADMIN_EMAILS and RBAC admin as
    // "user" — the ADMIN-002 bug surviving in the one screen an admin uses to
    // audit who has power.
    const assigned = await this.assignedConsultantIds(
      baseRows.map((r) => r.id),
    );

    const rows: AdminUserView[] = baseRows.map((r, i) => {
      const au = authUsers[i];
      return {
        id: r.id,
        email: r.email,
        fullName: r.full_name,
        status: r.status,
        appRole: resolveAppRoleFor(
          au?.email ?? r.email,
          au?.app_metadata,
          this.adminEmails,
          roleMap.get(r.id) ?? [],
          assigned.has(r.id),
        ),
        roles: roleMap.get(r.id) ?? [],
        lastSignInAt: au?.last_sign_in_at ?? null,
        bannedUntil:
          (au as { banned_until?: string } | undefined)?.banned_until ?? null,
        createdAt: r.created_at,
      };
    });
    return { rows, total: count ?? 0 };
  }

  async getUserDetail(id: string): Promise<AdminUserDetail> {
    const { data: row, error } = await this.db
      .from('users')
      .select(
        'id,email,full_name,nationality,status,status_reason,status_changed_at,created_at',
      )
      .eq('id', id)
      .single();
    if (error || !row) throw new NotFoundException('user not found');

    const { data: authRes } = await this.db.auth.admin.getUserById(id);
    const au = authRes?.user;

    const { count: applicationsCount, error: cErr } = await this.db
      .from('applications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', id);
    if (cErr) throw cErr;

    const { data: auditRows, error: aErr } = await this.db
      .from('auth_audit_log')
      .select('id,event_type,actor_id,created_at,metadata')
      .eq('user_id', id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (aErr) throw aErr;
    const recentAuth: AuthAuditRow[] = (auditRows ?? []).map(
      (a: {
        id: string;
        event_type: string;
        actor_id: string | null;
        created_at: string;
        metadata: Record<string, unknown> | null;
      }) => ({
        id: a.id,
        eventType: a.event_type,
        actorId: a.actor_id,
        createdAt: a.created_at,
        metadata: a.metadata ?? {},
      }),
    );

    const roleMap = await this.rolesByUser([id]);
    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      status: row.status as UserStatus,
      appRole: roleOf(au?.app_metadata),
      roles: roleMap.get(id) ?? [],
      lastSignInAt: au?.last_sign_in_at ?? null,
      bannedUntil:
        (au as { banned_until?: string } | undefined)?.banned_until ?? null,
      createdAt: row.created_at,
      nationality: row.nationality,
      emailConfirmedAt:
        (au as { email_confirmed_at?: string } | undefined)
          ?.email_confirmed_at ?? null,
      statusReason: row.status_reason,
      statusChangedAt: row.status_changed_at,
      applicationsCount: applicationsCount ?? 0,
      recentAuth,
    };
  }

  // ---- bulk (Task 5) ----
  async bulk(dto: BulkUsersDto, actorId: string): Promise<BulkActionResult> {
    const skipped: { id: string; reason: string }[] = [];
    const targets: GuardTarget[] = [];
    for (const id of dto.ids) {
      try {
        const t = await this.loadTarget(id);
        targets.push({ id: t.id, status: t.status, isAdmin: t.isAdmin });
      } catch (e) {
        skipped.push({
          id,
          reason: e instanceof Error ? e.message : 'load failed',
        });
      }
    }
    // Snapshot count → planBulk partitions with a running admin counter so a
    // batch can never drain the admin pool. Each applied action additionally
    // re-checks the guard with a fresh count (defense in depth).
    const adminCount = await this.adminCount();
    const { toApply, skipped: planSkipped } = planBulk(dto.action, targets, {
      actorId,
      adminCount,
    });
    skipped.push(...planSkipped);

    const succeeded: string[] = [];
    for (const id of toApply) {
      try {
        if (dto.action === 'suspend')
          await this.suspend(id, actorId, dto.reason);
        else if (dto.action === 'reactivate')
          await this.reactivate(id, actorId);
        else if (dto.action === 'soft-delete')
          await this.softDelete(id, actorId, dto.reason);
        else await this.restore(id, actorId);
        succeeded.push(id);
      } catch (e) {
        skipped.push({
          id,
          reason: e instanceof Error ? e.message : 'action failed',
        });
      }
    }
    return { succeeded, skipped };
  }
}
