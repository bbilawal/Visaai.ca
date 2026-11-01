import { authUserPages } from './auth-user-pages';
import type { ConfigService } from '@nestjs/config';
import {
  hasRbacAdminGrant,
  isPlatformAdmin,
  RBAC_ADMIN_ROLE_KEYS,
} from './user-admin-guards';
import {
  pageRows,
  toError,
  type RangeQuery,
} from '../shared/supabase/page-rows';

/** The slice of the GoTrue admin API this resolver needs. */
export interface AuthUserLister {
  auth: {
    admin: {
      listUsers: (params: { page: number; perPage: number }) => Promise<{
        data: {
          users: Array<{
            id: string;
            email?: string | null;
            app_metadata?: unknown;
          }>;
        } | null;
        error: { message: string } | null;
      }>;
    };
  };
}

interface UserRoleRow {
  user_id: string;
  roles: { key: string } | { key: string }[] | null;
}

/**
 * The slice of the PostgREST builder the grant reads use. Named rather than
 * `any` so a misspelled filter fails the build — the same reason
 * `admin-dashboard.service.ts` names its count chain.
 */
interface RoleGrantQuery extends RangeQuery<UserRoleRow> {
  select: (columns: string) => RoleGrantQuery;
  eq: (column: string, value: string) => RoleGrantQuery;
  in: (column: string, values: readonly string[]) => RoleGrantQuery;
}

/** The slice of PostgREST needed to read `user_roles` grants. */
export interface RoleGrantReader {
  from: (table: string) => RoleGrantQuery;
}

export type AdminDirectory = AuthUserLister & RoleGrantReader;

/** Also reads `users.status`, to exclude soft-deleted accounts from the count. */
interface UserStatusReader {
  from: (table: string) => {
    select: (columns: string) => {
      in: (
        column: string,
        values: readonly string[],
      ) => PromiseLike<{
        data: Array<{ id: string; status: string | null }> | null;
        error: unknown;
      }>;
    };
  };
}

function keysOf(row: UserRoleRow): string[] {
  const embed = row.roles;
  const list = Array.isArray(embed) ? embed : embed ? [embed] : [];
  return list.map((r) => r.key).filter(Boolean);
}

/**
 * Every user id holding a platform-admin RBAC grant.
 *
 * Mirrors `JwtGuard.grantedRoleKeys`, but for the whole platform in one query
 * so a bulk caller does not issue one lookup per user. Paged, because an
 * unbounded select stops at PGRST_DB_MAX_ROWS without saying so.
 *
 * Deliberately NOT fail-safe: the guard swallows its lookup error and returns
 * `[]` because failing to grant a role is the safe direction there. Here the
 * safe direction is the opposite — an empty set means "no admins", which drains
 * the last-admin protection and empties every alert recipient list. Callers
 * must see the failure.
 */
export async function loadRbacAdminIds(
  db: RoleGrantReader,
): Promise<ReadonlySet<string>> {
  const rows = await pageRows<UserRoleRow>(() =>
    db
      .from('user_roles')
      .select('user_id, roles!inner(key)')
      .in('roles.key', [...RBAC_ADMIN_ROLE_KEYS]),
  );
  return new Set(
    rows.filter((r) => hasRbacAdminGrant(keysOf(r))).map((r) => r.user_id),
  );
}

/** Whether ONE user holds a platform-admin RBAC grant. Same failure stance. */
export async function hasRbacAdminGrantFor(
  db: RoleGrantReader,
  userId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from('user_roles')
    .select('user_id, roles(key)')
    .eq('user_id', userId);
  if (error) throw toError(error);
  return (data ?? []).some((r) => hasRbacAdminGrant(keysOf(r)));
}

/**
 * The configured admin allow-list, as a lowercase set.
 *
 * Falls back to `process.env` when no ConfigService is supplied, because the
 * validated config is itself derived from that variable. The fallback exists so
 * this can never quietly resolve to "no admins" in a runtime where DI handed us
 * nothing — an empty set here is indistinguishable from "the alert fired and
 * nobody needed to know", which is exactly the failure being fixed below.
 */
export function resolveAdminEmails(
  config?: { get: ConfigService['get'] } | null,
): ReadonlySet<string> {
  const fromConfig = config?.get<string[] | string | undefined>('ADMIN_EMAILS');
  const raw = fromConfig ?? process.env.ADMIN_EMAILS ?? [];
  const list = Array.isArray(raw) ? raw : raw.split(',');
  return new Set(
    list.map((s) => String(s).trim().toLowerCase()).filter(Boolean),
  );
}

/**
 * Every platform admin's user id, paged through the GoTrue admin API.
 *
 * OPS-001: three services (template health, notification DLQ, admin broadcasts)
 * each had their own copy of this loop, and every copy matched on
 * `app_metadata.role === 'admin'` alone. That key is seeded for 1 of 50
 * production users and — as ADMIN-002 established when `adminCount` came back 0
 * — for NO user with the admin role. So all three yielded nothing: the
 * watchdogs ran, found real problems, addressed the alert to an empty set, and
 * recorded `sent > 0 === false` as a warn line nobody reads. A watchdog that
 * cannot reach anyone is worse than no watchdog, because its silence is
 * indistinguishable from good news.
 *
 * Recipients now resolve the same way the login gate does (see
 * `isPlatformAdmin`), so the people who can actually get into /admin are the
 * people who get told when it is on fire.
 */
export async function* platformAdminIds(
  db: AdminDirectory,
  adminEmails: ReadonlySet<string>,
): AsyncGenerator<string> {
  // One query for the whole platform, before the paging loop — an admin created
  // through the RBAC tables carries no `app_metadata.role` and may not be on the
  // allow-list, and was invisible to every caller here until this was added.
  const rbacAdmins = await loadRbacAdminIds(db);
  // Page until empty: GoTrue caps pages at ~50, so "shorter than the requested page"
  // ended after the 50 newest users (see auth-user-pages).
  for await (const users of authUserPages(db as never)) {
    for (const u of users) {
      if (
        isPlatformAdmin(
          u.email,
          u.app_metadata,
          adminEmails,
          rbacAdmins.has(u.id),
        )
      )
        yield u.id;
    }
  }
}

/**
 * How many platform admins can actually sign in right now.
 *
 * THE ONLY implementation. `IamRepository.countPlatformAdmins` was a second
 * one, and the two disagreed in both directions:
 *
 *  - It counted `user_roles` grants and nothing else, so an admin holding the
 *    role through `app_metadata` or ADMIN_EMAILS was invisible to it. Failing
 *    closed, but wrong.
 *  - It applied no `users.status` filter, and the lifecycle path
 *    (`AdminUsersService.apply`) bans the auth user and updates `users.status`
 *    WITHOUT touching `user_roles` — so a soft-deleted admin's grant row
 *    survives and kept being counted. That direction orphans the platform:
 *    with one soft-deleted admin and one live RBAC-only admin, the revoke guard
 *    saw 2, allowed the revoke, and left zero admins who could sign in.
 *
 * Two guards protecting the same invariant must not be able to disagree about
 * the number, which is the whole lesson of ADMIN-002.
 *
 * Note there is deliberately NO `organization_id` filter on the grant read:
 * `JwtGuard.grantedRoleKeys` has none either, so an org-scoped platform_admin
 * grant really does resolve to a platform-wide admin at the gate. Filtering it
 * out here would undercount someone who can genuinely get in.
 */
export async function countPlatformAdmins(
  db: AdminDirectory,
  adminEmails: ReadonlySet<string>,
): Promise<number> {
  const ids: string[] = [];
  for await (const id of platformAdminIds(db, adminEmails)) ids.push(id);
  if (ids.length === 0) return 0;
  // `db.from` is typed for the grant read; the users read has a different row
  // shape, so narrow it explicitly rather than widening the shared interface.
  const statusReader = db as unknown as UserStatusReader;
  const { data, error } = await statusReader
    .from('users')
    .select('id,status')
    .in('id', ids);
  if (error) throw toError(error);
  // A user with no `users` row still holds their auth identity and can sign in,
  // so absence is not deletion — only an explicit 'deleted' status excludes.
  const deleted = new Set(
    (data ?? []).filter((r) => r.status === 'deleted').map((r) => r.id),
  );
  return ids.filter((id) => !deleted.has(id)).length;
}
