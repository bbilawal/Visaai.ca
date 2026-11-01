/**
 * IAM engine — pure RBAC / lockout / invitation logic (no DB, no clock injected
 * as `now`). Mirrors commission.engine / payouts.engine: deterministic functions
 * the services compose over DB snapshots. Keeps the security-sensitive rules unit
 * tested and free of I/O.
 */
import { randomBytes } from 'node:crypto';
import type { RoleKey } from '@visaai/types';

/** Wildcard permission held only by super_admin. */
export const ALL_PERMISSIONS = '*';

/**
 * Brute-force policy (SEC-001).
 *
 * Lockouts are keyed on (email, ip), NOT on email alone. Email-alone made
 * `POST /auth/record-login` — unauthenticated, and trusting `success` from the
 * client — into a remote account-denial primitive: five posts locked a named
 * person out of their own account.
 *
 * Keying per address fixes that but would let an attacker with N addresses take
 * 5 attempts each, so the email-wide ceiling below stays as a backstop against
 * a distributed attempt. Both must hold.
 */
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;
/**
 * Email-wide backstop: how many DISTINCT addresses may be locked against one
 * account at the same time before the account locks for everyone.
 *
 * Counting addresses rather than summing failures is not a style choice —
 * `nextLockoutState` RESETS failed_count to 0 at the moment it sets
 * locked_until, so an email-wide sum of that column is ~0 no matter how many
 * addresses are attacking. A test caught that; the first version of this
 * backstop could never have fired.
 *
 * Ten is deliberately high. Too low and it hands back the denial-of-service
 * this whole fix removes: an attacker with ten cheap addresses could lock any
 * account at will.
 */
export const MAX_LOCKED_ADDRESSES = 10;
/**
 * Bucket for attempts whose source address could not be determined. Distinct
 * from the migration's '0.0.0.0' sentinel, which marks pre-migration rows.
 */
export const UNKNOWN_IP = 'unknown';
/** Invitations expire after this many days. */
export const INVITATION_TTL_DAYS = 7;

/**
 * Union the permission sets of the caller's roles. A role carrying '*'
 * (super_admin) collapses to all-permissions. Returns a de-duplicated list.
 */
export function resolvePermissions(rolePermissionSets: string[][]): string[] {
  const out = new Set<string>();
  for (const set of rolePermissionSets) {
    for (const p of set) out.add(p);
  }
  return [...out];
}

/** True if `permissions` grants `required` (wildcard '*' grants everything). */
export function hasPermission(
  permissions: string[],
  required: string,
): boolean {
  return (
    permissions.includes(ALL_PERMISSIONS) || permissions.includes(required)
  );
}

/**
 * Map the fine-grained 6-role set onto the legacy signed claim
 * {admin|consultant|user} so existing RolesGuard + RLS policies keep working.
 *   platform_admin | super_admin              -> admin
 *   consultant                                -> consultant
 *   applicant | support_agent | org_admin     -> user
 * (org_admin deliberately does NOT get platform 'admin' reach — its power comes
 * from org-scoped permissions enforced by PermissionsGuard, not legacy RLS.)
 */
export function legacyAppRole(
  roleKeys: RoleKey[],
): 'admin' | 'consultant' | 'user' {
  if (roleKeys.includes('platform_admin') || roleKeys.includes('super_admin')) {
    return 'admin';
  }
  if (roleKeys.includes('consultant')) return 'consultant';
  return 'user';
}

// ---- Account lockout (brute-force) -----------------------------------

export interface LockoutState {
  failed_count: number;
  locked_until: string | null;
}

/** True if the account is currently locked at `now` (ISO). */
export function isLocked(state: LockoutState | null, now: Date): boolean {
  if (!state?.locked_until) return false;
  return new Date(state.locked_until).getTime() > now.getTime();
}

/**
 * Next lockout state after an attempt.
 *  - success: reset (count 0, unlocked)
 *  - failure: increment; at MAX_FAILED_ATTEMPTS set locked_until = now + window
 *    and reset the counter so the next window starts fresh after expiry.
 */
export function nextLockoutState(
  state: LockoutState | null,
  success: boolean,
  now: Date,
): LockoutState & { last_failed_at: string | null; just_locked: boolean } {
  if (success) {
    return {
      failed_count: 0,
      locked_until: null,
      last_failed_at: null,
      just_locked: false,
    };
  }
  const count = (state?.failed_count ?? 0) + 1;
  if (count >= MAX_FAILED_ATTEMPTS) {
    const until = new Date(
      now.getTime() + LOCKOUT_MINUTES * 60_000,
    ).toISOString();
    return {
      failed_count: 0,
      locked_until: until,
      last_failed_at: now.toISOString(),
      just_locked: true,
    };
  }
  return {
    failed_count: count,
    locked_until: null,
    last_failed_at: now.toISOString(),
    just_locked: false,
  };
}

// ---- Invitations -----------------------------------------------------

/** Cryptographically-random opaque invite token (URL-safe). */
export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Expiry timestamp for a new invitation. */
export function invitationExpiry(now: Date): string {
  return new Date(
    now.getTime() + INVITATION_TTL_DAYS * 86_400_000,
  ).toISOString();
}

export interface InvitationLike {
  status: string;
  expires_at: string;
}

/** A pending, unexpired invitation is acceptable. */
export function isInvitationAcceptable(
  inv: InvitationLike | null,
  now: Date,
): boolean {
  if (!inv) return false;
  if (inv.status !== 'pending') return false;
  return new Date(inv.expires_at).getTime() > now.getTime();
}

// ---- Org slug --------------------------------------------------------

/** URL-safe slug from an org name; caller appends a suffix on collision. */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'org';
}
