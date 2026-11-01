import { Injectable } from '@nestjs/common';
import type {
  AccountLockout,
  LoginHistoryEntry,
  Organization,
  OrganizationInvitation,
  OrganizationMember,
  OrgMemberRole,
  Permission,
  Role,
  RoleKey,
  UserProfile,
} from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import {
  countPlatformAdmins,
  resolveAdminEmails,
  type AdminDirectory,
} from '../admin/admin-recipients';
import { resolvePermissions } from './iam.engine';
import type {
  AuthAuditRecord,
  CreateInvitationInput,
  CreateOrgInput,
  GrantRoleInput,
  IIamRepository,
  LoginRecord,
} from './iam.repository';

/** PostgREST returns embeds as array (to-many) or object (to-one) — normalize. */
function one<T>(embed: unknown): T | null {
  if (Array.isArray(embed)) return (embed[0] as T) ?? null;
  return (embed as T) ?? null;
}

const ROLE_COLS = 'id, key, name, description, scope, is_system, created_at';
const ORG_COLS =
  'id, name, slug, owner_user_id, plan, settings, created_at, updated_at';
const MEMBER_COLS = 'id, organization_id, user_id, role, status, joined_at';
const INVITE_COLS =
  'id, organization_id, email, role, token, invited_by, status, expires_at, created_at, accepted_at';
const PROFILE_COLS =
  'user_id, first_name, last_name, phone, address_line1, address_line2, city, region, postal_code, country, timezone, avatar_url, privacy, created_at, updated_at';

/**
 * DEBT-001 boundary mappers.
 *
 * When the Supabase client is bound to the generated schema types (RT-026), the
 * query builder returns what Postgres actually stores: `roles.key` and
 * `roles.scope` are plain `text`, and `organizations.settings` is `Json`. The
 * domain types narrow those to unions and `Record<string, unknown>`.
 *
 * The repository is the seam where an untyped row becomes a domain object, so
 * the narrowing belongs here — and it is CHECKED rather than asserted. A `text`
 * column with no enum constraint can hold anything; casting it to a union with
 * `as` would let an unrecognised value flow through the permission system typed
 * as a valid role.
 */

/**
 * A Record, not a Set, so TypeScript enforces EXHAUSTIVENESS: adding a member
 * to RoleKey without adding it here fails to compile. A hand-written
 * `new Set<RoleKey>([...])` silently accepts a subset — which is how the first
 * draft of this invented `billing_admin` and omitted `super_admin`.
 */
const ROLE_KEY_TABLE: Record<RoleKey, true> = {
  applicant: true,
  consultant: true,
  support_agent: true,
  org_admin: true,
  platform_admin: true,
  super_admin: true,
};
const ROLE_KEYS = new Set<string>(Object.keys(ROLE_KEY_TABLE));

function toRole(row: {
  id: string;
  key: string;
  name: string;
  description: string | null;
  scope: string;
  is_system: boolean;
  created_at: string;
}): Role {
  if (!ROLE_KEYS.has(row.key)) {
    // Fail loudly. An unknown role key reaching the permission system as if it
    // were valid is the failure mode this check exists to prevent.
    throw new Error(
      `roles.key "${row.key}" is not a known RoleKey — the database and ` +
        `@visaai/types have diverged. Update RoleKey or fix the row.`,
    );
  }
  if (row.scope !== 'platform' && row.scope !== 'organization') {
    throw new Error(
      `roles.scope "${row.scope}" is not a known RoleScope (platform | organization).`,
    );
  }
  return { ...row, key: row.key as RoleKey, scope: row.scope };
}

@Injectable()
export class IamRepository implements IIamRepository {
  constructor(private readonly supabase: SupabaseService) {}

  private get db() {
    return this.supabase.admin;
  }

  // ---- roles / permissions / access ----
  async listRoles(): Promise<Role[]> {
    const { data, error } = await this.db
      .from('roles')
      .select(ROLE_COLS)
      .order('key');
    if (error) throw error;
    return (data ?? []).map(toRole);
  }

  async listPermissions(): Promise<Permission[]> {
    const { data, error } = await this.db
      .from('permissions')
      .select('id, key, description, created_at')
      .order('key');
    if (error) throw error;
    return data ?? [];
  }

  async getRoleByKey(key: RoleKey): Promise<Role | null> {
    const { data, error } = await this.db
      .from('roles')
      .select(ROLE_COLS)
      .eq('key', key)
      .maybeSingle();
    if (error) throw error;
    return data ? toRole(data) : null;
  }

  async getUserAccess(
    userId: string,
  ): Promise<{ roles: RoleKey[]; permissions: string[] }> {
    const { data: ur, error } = await this.db
      .from('user_roles')
      .select('role_id, roles(key)')
      .eq('user_id', userId);
    if (error) throw error;

    const roleKeys: RoleKey[] = [];
    const roleIds: string[] = [];
    for (const row of ur ?? []) {
      const r = row as Record<string, unknown>;
      const role = one<{ key: RoleKey }>(r.roles);
      if (role) roleKeys.push(role.key);
      roleIds.push(String(r.role_id));
    }
    if (roleIds.length === 0) return { roles: [], permissions: [] };

    const { data: rp, error: pErr } = await this.db
      .from('role_permissions')
      .select('permissions(key)')
      .in('role_id', roleIds);
    if (pErr) throw pErr;

    const permKeys: string[] = [];
    for (const row of rp ?? []) {
      const perm = one<{ key: string }>(
        (row as Record<string, unknown>).permissions,
      );
      if (perm) permKeys.push(perm.key);
    }
    return {
      roles: [...new Set(roleKeys)],
      permissions: resolvePermissions([permKeys]),
    };
  }

  async grantRole(input: GrantRoleInput): Promise<void> {
    const { error } = await this.db.from('user_roles').upsert(
      {
        user_id: input.userId,
        role_id: input.roleId,
        organization_id: input.organizationId,
        granted_by: input.grantedBy,
      },
      { onConflict: 'user_id,role_id,organization_id' },
    );
    if (error) throw error;
  }

  async revokeRole(
    userId: string,
    roleKey: RoleKey,
    organizationId: string | null,
  ): Promise<boolean> {
    const role = await this.getRoleByKey(roleKey);
    if (!role) return false;
    let q = this.db
      .from('user_roles')
      .delete()
      .eq('user_id', userId)
      .eq('role_id', role.id);
    q = organizationId
      ? q.eq('organization_id', organizationId)
      : q.is('organization_id', null);
    const { data, error } = await q.select('id');
    if (error) throw error;
    return (data ?? []).length > 0;
  }

  async countPlatformAdmins(): Promise<number> {
    // Delegates to the ONE implementation (see its doc comment). This used to
    // count `user_roles` rows directly, which both missed admins holding the
    // role via app_metadata/ADMIN_EMAILS and kept counting admins whose account
    // had been soft-deleted — the lifecycle path never touches `user_roles`.
    // That second direction let `RolesService.revoke` remove the last admin who
    // could actually sign in while believing two remained.
    return countPlatformAdmins(
      this.db as unknown as AdminDirectory,
      resolveAdminEmails(),
    );
  }

  // ---- organizations ----
  async createOrganization(input: CreateOrgInput): Promise<Organization> {
    const { data, error } = await this.db
      .from('organizations')
      .insert({
        name: input.name,
        slug: input.slug,
        owner_user_id: input.ownerUserId,
        plan: input.plan ?? 'free',
      })
      .select(ORG_COLS)
      .single();
    if (error) throw error;
    return data;
  }

  async slugExists(slug: string): Promise<boolean> {
    const { data, error } = await this.db
      .from('organizations')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();
    if (error) throw error;
    return !!data;
  }

  async getOrganization(id: string): Promise<Organization | null> {
    const { data, error } = await this.db
      .from('organizations')
      .select(ORG_COLS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  }

  async listOrganizationsForUser(userId: string): Promise<Organization[]> {
    const { data: members, error } = await this.db
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userId)
      .eq('status', 'active');
    if (error) throw error;
    const ids = (members ?? []).map((m) => String(m.organization_id));
    if (ids.length === 0) return [];
    const { data, error: oErr } = await this.db
      .from('organizations')
      .select(ORG_COLS)
      .in('id', ids);
    if (oErr) throw oErr;
    return data ?? [];
  }

  async updateOrganization(
    id: string,
    patch: Partial<Pick<Organization, 'name' | 'plan' | 'settings'>>,
  ): Promise<Organization | null> {
    const { data, error } = await this.db
      .from('organizations')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(ORG_COLS)
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  }

  // ---- members ----
  async addMember(input: {
    organizationId: string;
    userId: string;
    role: OrgMemberRole;
    status?: 'active' | 'suspended';
  }): Promise<OrganizationMember> {
    const { data, error } = await this.db
      .from('organization_members')
      .upsert(
        {
          organization_id: input.organizationId,
          user_id: input.userId,
          role: input.role,
          status: input.status ?? 'active',
        },
        { onConflict: 'organization_id,user_id' },
      )
      .select(MEMBER_COLS)
      .single();
    if (error) throw error;
    return data;
  }

  async listMembers(organizationId: string): Promise<OrganizationMember[]> {
    const { data, error } = await this.db
      .from('organization_members')
      .select(MEMBER_COLS)
      .eq('organization_id', organizationId)
      .order('joined_at');
    if (error) throw error;
    return data ?? [];
  }

  async getMember(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMember | null> {
    const { data, error } = await this.db
      .from('organization_members')
      .select(MEMBER_COLS)
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  }

  async updateMember(
    organizationId: string,
    userId: string,
    patch: Partial<Pick<OrganizationMember, 'role' | 'status'>>,
  ): Promise<boolean> {
    const { data, error } = await this.db
      .from('organization_members')
      .update(patch)
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .select('id');
    if (error) throw error;
    return (data ?? []).length > 0;
  }

  async removeMember(organizationId: string, userId: string): Promise<boolean> {
    const { data, error } = await this.db
      .from('organization_members')
      .delete()
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .select('id');
    if (error) throw error;
    return (data ?? []).length > 0;
  }

  // ---- invitations ----
  async createInvitation(
    input: CreateInvitationInput,
  ): Promise<OrganizationInvitation> {
    const { data, error } = await this.db
      .from('organization_invitations')
      .insert({
        organization_id: input.organizationId,
        email: input.email.toLowerCase(),
        role: input.role,
        token: input.token,
        invited_by: input.invitedBy,
        expires_at: input.expiresAt,
      })
      .select(INVITE_COLS)
      .single();
    if (error) throw error;
    return data;
  }

  async getInvitationByToken(
    token: string,
  ): Promise<OrganizationInvitation | null> {
    const { data, error } = await this.db
      .from('organization_invitations')
      .select(INVITE_COLS)
      .eq('token', token)
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  }

  async listInvitations(
    organizationId: string,
  ): Promise<OrganizationInvitation[]> {
    const { data, error } = await this.db
      .from('organization_invitations')
      .select(INVITE_COLS)
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async setInvitationStatus(
    id: string,
    organizationId: string,
    status: OrganizationInvitation['status'],
    acceptedAt?: string | null,
  ): Promise<boolean> {
    // Scoped by BOTH id and organization, like removeMember/updateMember. With
    // the id alone, an admin of their own organization could revoke a pending
    // invitation belonging to a different one by naming its UUID — the caller's
    // assertAdmin check proves nothing about the row being written.
    const { data, error } = await this.db
      .from('organization_invitations')
      .update({ status, accepted_at: acceptedAt ?? null })
      .eq('id', id)
      .eq('organization_id', organizationId)
      .select('id');
    if (error) throw error;
    return (data ?? []).length > 0;
  }

  // ---- profile ----
  async getProfile(userId: string): Promise<UserProfile | null> {
    const { data, error } = await this.db
      .from('user_profiles')
      .select(PROFILE_COLS)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  }

  async upsertProfile(
    userId: string,
    patch: Partial<Omit<UserProfile, 'user_id' | 'created_at' | 'updated_at'>>,
  ): Promise<UserProfile> {
    const { data, error } = await this.db
      .from('user_profiles')
      .upsert(
        { user_id: userId, ...patch, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      )
      .select(PROFILE_COLS)
      .single();
    if (error) throw error;
    return data;
  }

  async findUserIdByEmail(email: string): Promise<string | null> {
    const { data, error } = await this.db
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .maybeSingle();
    if (error) throw error;
    return data ? String(data.id) : null;
  }

  // ---- security / audit ----
  async recordLogin(rec: LoginRecord): Promise<void> {
    const { error } = await this.db.from('login_history').insert({
      user_id: rec.userId,
      email: rec.email,
      success: rec.success,
      failure_reason: rec.failureReason ?? null,
      ip: rec.ip ?? null,
      user_agent: rec.userAgent ?? null,
    });
    if (error) throw error;
  }

  async listLoginHistory(
    userId: string,
    limit: number,
  ): Promise<LoginHistoryEntry[]> {
    const { data, error } = await this.db
      .from('login_history')
      .select(
        'id, user_id, email, success, failure_reason, ip, user_agent, created_at',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  }

  async recordAuthEvent(rec: AuthAuditRecord): Promise<void> {
    const { error } = await this.db.from('auth_audit_log').insert({
      user_id: rec.userId,
      actor_id: rec.actorId ?? null,
      event_type: rec.eventType,
      ip: rec.ip ?? null,
      user_agent: rec.userAgent ?? null,
      metadata: rec.metadata ?? {},
    });
    if (error) throw error;
  }

  /**
   * SEC-001. Keyed on (email, ip), never email alone.
   *
   * `POST /auth/record-login` is unauthenticated and takes `success` from the
   * CLIENT. While this table was keyed on email only, five posts of
   * `{email: <victim>, success: false}` locked a named person out of their own
   * account from anywhere on the internet. Keying on the pair means an attacker
   * can only lock the victim at the ATTACKER'S address.
   */
  async getLockout(email: string, ip: string): Promise<AccountLockout | null> {
    const { data, error } = await this.db
      .from('account_lockouts')
      .select(
        'email, ip, failed_count, locked_until, last_failed_at, updated_at',
      )
      .eq('email', email.toLowerCase())
      .eq('ip', ip)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      email: String(data.email),
      ip: String(data.ip),
      failed_count: Number(data.failed_count ?? 0),
      locked_until: (data.locked_until as string | null) ?? null,
      last_failed_at: (data.last_failed_at as string | null) ?? null,
      updated_at: String(data.updated_at),
    };
  }

  /**
   * The distributed-attempt backstop. Per-address keying alone would hand an
   * attacker with N addresses MAX_FAILED_ATTEMPTS each, forever, so the number
   * of currently-locked addresses for one email is capped separately.
   *
   * Counts LOCKED ADDRESSES rather than summing `failed_count`: the lock resets
   * that counter, so a sum-based ceiling could never fire.
   */
  async getEmailWideLockout(
    email: string,
    now: Date = new Date(),
  ): Promise<{ locked_addresses: number; locked_until: string | null }> {
    const { data, error } = await this.db
      .from('account_lockouts')
      .select('locked_until')
      .eq('email', email.toLowerCase())
      .gt('locked_until', now.toISOString());
    if (error) throw error;
    const rows = (data ?? []) as { locked_until: string | null }[];
    let locked_until: string | null = null;
    for (const r of rows) {
      if (r.locked_until && (!locked_until || r.locked_until > locked_until)) {
        locked_until = r.locked_until;
      }
    }
    return { locked_addresses: rows.length, locked_until };
  }

  async upsertLockout(
    email: string,
    ip: string,
    state: {
      failed_count: number;
      locked_until: string | null;
      last_failed_at: string | null;
    },
  ): Promise<void> {
    const { error } = await this.db.from('account_lockouts').upsert(
      {
        email: email.toLowerCase(),
        ip,
        failed_count: state.failed_count,
        locked_until: state.locked_until,
        last_failed_at: state.last_failed_at,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'email,ip' },
    );
    if (error) throw error;
  }
}
