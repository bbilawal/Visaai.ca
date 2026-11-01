import type { UserStatus } from '@visaai/types';

export type LifecycleAction =
  | 'suspend'
  | 'reactivate'
  | 'soft-delete'
  | 'restore';
export type GuardDecision =
  | { allowed: true }
  | { allowed: false; reason: string };
export interface GuardTarget {
  id: string;
  status: UserStatus;
  isAdmin: boolean;
}
export interface GuardCtx {
  actorId: string;
  target: GuardTarget;
  adminCount: number;
}

const LEGAL: Record<LifecycleAction, { from: UserStatus[]; to: UserStatus }> = {
  suspend: { from: ['active'], to: 'suspended' },
  reactivate: { from: ['suspended'], to: 'active' },
  'soft-delete': { from: ['active', 'suspended'], to: 'deleted' },
  restore: { from: ['deleted'], to: 'active' },
};
const REMOVES_ACCESS: LifecycleAction[] = ['suspend', 'soft-delete'];

/**
 * Fail-closed validation of an admin count. `NaN <= 1` is `false`, so a NaN (from
 * a failed count query / coercion) would otherwise silently bypass the last-admin
 * guard. Treat any non-finite / non-integer / negative count as untrustworthy and
 * deny — this is the security backstop before a destructive write.
 */
function validAdminCount(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

export function canLifecycle(
  action: LifecycleAction,
  ctx: GuardCtx,
): GuardDecision {
  const legal = LEGAL[action];
  if (!legal.from.includes(ctx.target.status))
    return {
      allowed: false,
      reason: `illegal transition: ${ctx.target.status} -> ${legal.to}`,
    };
  if (REMOVES_ACCESS.includes(action)) {
    if (ctx.target.id === ctx.actorId)
      return {
        allowed: false,
        reason: 'cannot suspend or delete your own account',
      };
    if (ctx.target.isAdmin) {
      if (!validAdminCount(ctx.adminCount))
        return { allowed: false, reason: 'invalid adminCount' };
      if (ctx.adminCount <= 1)
        return {
          allowed: false,
          reason: 'cannot remove access from the last platform admin',
        };
    }
  }
  return { allowed: true };
}

export function canRemoveAdmin(ctx: {
  actorId: string;
  targetId: string;
  targetIsAdmin: boolean;
  adminCount: number;
}): GuardDecision {
  if (!ctx.targetIsAdmin) return { allowed: true };
  if (ctx.targetId === ctx.actorId)
    return { allowed: false, reason: 'cannot remove your own admin role' };
  if (!validAdminCount(ctx.adminCount))
    return { allowed: false, reason: 'invalid adminCount' };
  if (ctx.adminCount <= 1)
    return { allowed: false, reason: 'cannot remove the last platform admin' };
  return { allowed: true };
}

export function planBulk(
  action: LifecycleAction,
  targets: GuardTarget[],
  common: { actorId: string; adminCount: number },
): { toApply: string[]; skipped: { id: string; reason: string }[] } {
  const toApply: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  // Fail closed: an untrustworthy count would let the running-counter logic drain
  // the admin pool. Skip the entire batch rather than risk orphaning the platform.
  if (REMOVES_ACCESS.includes(action) && !validAdminCount(common.adminCount))
    return {
      toApply,
      skipped: targets.map((t) => ({ id: t.id, reason: 'invalid adminCount' })),
    };
  let remainingAdmins = common.adminCount; // decrement as admins are queued for access removal
  for (const t of targets) {
    const d = canLifecycle(action, {
      actorId: common.actorId,
      target: t,
      adminCount: remainingAdmins,
    });
    if (d.allowed) {
      toApply.push(t.id);
      if (REMOVES_ACCESS.includes(action) && t.isAdmin) remainingAdmins -= 1;
    } else {
      skipped.push({ id: t.id, reason: d.reason });
    }
  }
  return { toApply, skipped };
}

/**
 * RBAC role keys that `JwtGuard.resolveAppRole` maps onto the legacy `admin`
 * claim. `applicant`/`support_agent`/`org_admin` carry no elevated legacy reach
 * (their power is enforced by PermissionsGuard), so they are not admins here.
 */
export const RBAC_ADMIN_ROLE_KEYS = ['platform_admin', 'super_admin'] as const;

/** Does this set of granted role keys make the holder a platform admin? */
export function hasRbacAdminGrant(keys: readonly string[]): boolean {
  return keys.some((k) =>
    (RBAC_ADMIN_ROLE_KEYS as readonly string[]).includes(k),
  );
}

/**
 * Is this auth user a platform admin?
 *
 * The single answer to that question, and a faithful port of the ADMIN branch
 * of `JwtGuard.resolveAppRole` — same three sources, in the SAME ORDER:
 *
 *   1. signed `app_metadata.role`, if it holds a valid value. This SHORT-
 *      CIRCUITS: a stored 'user' or 'consultant' means the guard never consults
 *      anything else, so neither may we. Someone on the allow-list whose
 *      metadata says 'user' cannot reach /admin, and counting them as an admin
 *      would inflate `adminCount` and let the real last admin be removed.
 *   2. the configured `ADMIN_EMAILS` allow-list.
 *   3. a `platform_admin` / `super_admin` grant in `user_roles`.
 *
 * Getting this wrong in either direction is the same bug twice. ADMIN-002 was
 * source (1) alone: `app_metadata.role` is seeded for 1 of 50 production users,
 * so callers that checked only it saw ZERO admins and silently did nothing.
 * Then sources (1)+(2) alone still missed every admin created through the RBAC
 * tables — omitting them from watchdog recipients and from `adminCount`, and
 * leaving them demotable: writing the valid legacy role 'user' over an RBAC
 * admin makes step 1 short-circuit forever after, and the grant that would have
 * let them back in is never reached.
 *
 * So: every place that decides "who is an admin" calls this, and supplies all
 * three inputs. A caller that cannot answer (3) must not guess `false` — it
 * must load the grants. See `admin-recipients.ts`.
 */
export function isPlatformAdmin(
  email: string | null | undefined,
  appMetadata: unknown,
  adminEmails: ReadonlySet<string>,
  rbacAdminGrant = false,
): boolean {
  // 1. Signed metadata wins outright, exactly as the guard has it.
  const raw = (appMetadata as { role?: unknown } | undefined)?.role;
  if (raw === 'admin' || raw === 'consultant' || raw === 'user')
    return raw === 'admin';
  // 2. Server-config allow-list.
  if (email && adminEmails.has(email.toLowerCase())) return true;
  // 3. RBAC grant.
  return rbacAdminGrant;
}

export type ResolvedAppRole = 'admin' | 'consultant' | 'user';

/**
 * The app role `JwtGuard` would resolve for this user — the whole ladder, not
 * just the admin rung.
 *
 * `isPlatformAdmin` answers "can they reach /admin". This answers "what role
 * will they actually have", which is what the admin Users screen must show and
 * what the consultant picker must filter on. Both were reading
 * `app_metadata.role` alone, so an admin who holds the role via ADMIN_EMAILS or
 * an RBAC grant was listed as "user", and a consultant granted the role through
 * the RBAC tables never appeared in the assignment picker at all.
 *
 * Mirrors `JwtGuard.resolveAppRole` step for step:
 *   1. signed `app_metadata.role`, short-circuiting on any valid value
 *   2. ADMIN_EMAILS -> admin
 *   3. platform_admin / super_admin grant -> admin; consultant grant -> consultant
 *   4. an active consultant_assignments row -> consultant
 *   5. 'user'
 */
export function resolveAppRoleFor(
  email: string | null | undefined,
  appMetadata: unknown,
  adminEmails: ReadonlySet<string>,
  grantedRoleKeys: readonly string[] = [],
  hasActiveConsultantAssignment = false,
): ResolvedAppRole {
  const raw = (appMetadata as { role?: unknown } | undefined)?.role;
  if (raw === 'admin' || raw === 'consultant' || raw === 'user') return raw;
  if (email && adminEmails.has(email.toLowerCase())) return 'admin';
  if (hasRbacAdminGrant(grantedRoleKeys)) return 'admin';
  if (grantedRoleKeys.includes('consultant')) return 'consultant';
  if (hasActiveConsultantAssignment) return 'consultant';
  return 'user';
}
