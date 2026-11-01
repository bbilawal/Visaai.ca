import type {
  AccountLockout,
  AuthAuditEntry,
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

export const IAM_REPOSITORY = Symbol('IAM_REPOSITORY');

export interface GrantRoleInput {
  userId: string;
  roleId: string;
  organizationId: string | null;
  grantedBy: string | null;
}

export interface CreateOrgInput {
  name: string;
  slug: string;
  ownerUserId: string;
  plan?: string;
}

export interface CreateInvitationInput {
  organizationId: string;
  email: string;
  role: OrgMemberRole;
  token: string;
  invitedBy: string | null;
  expiresAt: string;
}

export interface LoginRecord {
  userId: string | null;
  email: string | null;
  success: boolean;
  failureReason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuthAuditRecord {
  userId: string | null;
  actorId?: string | null;
  eventType: AuthAuditEntry['event_type'];
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * IAM persistence (service-role; RLS bypassed). The services authorize the caller
 * before every read/write; the RLS policies in the migration are defense-in-depth
 * for the direct user-JWT path.
 */
export interface IIamRepository {
  // ---- roles / permissions / access ----
  listRoles(): Promise<Role[]>;
  listPermissions(): Promise<Permission[]>;
  getRoleByKey(key: RoleKey): Promise<Role | null>;
  /** Resolve a user's role keys + the union of their permission keys. */
  getUserAccess(
    userId: string,
  ): Promise<{ roles: RoleKey[]; permissions: string[] }>;
  grantRole(input: GrantRoleInput): Promise<void>;
  /** Revoke a (user, roleKey, org-scope) grant; false if nothing matched. */
  revokeRole(
    userId: string,
    roleKey: RoleKey,
    organizationId: string | null,
  ): Promise<boolean>;
  /** Distinct users holding a platform-scoped admin role (platform_admin|super_admin). */
  countPlatformAdmins(): Promise<number>;

  // ---- organizations ----
  createOrganization(input: CreateOrgInput): Promise<Organization>;
  slugExists(slug: string): Promise<boolean>;
  getOrganization(id: string): Promise<Organization | null>;
  listOrganizationsForUser(userId: string): Promise<Organization[]>;
  updateOrganization(
    id: string,
    patch: Partial<Pick<Organization, 'name' | 'plan' | 'settings'>>,
  ): Promise<Organization | null>;

  // ---- members ----
  addMember(input: {
    organizationId: string;
    userId: string;
    role: OrgMemberRole;
    status?: 'active' | 'suspended';
  }): Promise<OrganizationMember>;
  listMembers(organizationId: string): Promise<OrganizationMember[]>;
  getMember(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMember | null>;
  updateMember(
    organizationId: string,
    userId: string,
    patch: Partial<Pick<OrganizationMember, 'role' | 'status'>>,
  ): Promise<boolean>;
  removeMember(organizationId: string, userId: string): Promise<boolean>;

  // ---- invitations ----
  createInvitation(
    input: CreateInvitationInput,
  ): Promise<OrganizationInvitation>;
  getInvitationByToken(token: string): Promise<OrganizationInvitation | null>;
  listInvitations(organizationId: string): Promise<OrganizationInvitation[]>;
  setInvitationStatus(
    id: string,
    organizationId: string,
    status: OrganizationInvitation['status'],
    acceptedAt?: string | null,
  ): Promise<boolean>;

  // ---- profile ----
  getProfile(userId: string): Promise<UserProfile | null>;
  upsertProfile(
    userId: string,
    patch: Partial<Omit<UserProfile, 'user_id' | 'created_at' | 'updated_at'>>,
  ): Promise<UserProfile>;
  /** Resolve a user id from an email (for invitations). */
  findUserIdByEmail(email: string): Promise<string | null>;

  // ---- security / audit ----
  recordLogin(rec: LoginRecord): Promise<void>;
  listLoginHistory(userId: string, limit: number): Promise<LoginHistoryEntry[]>;
  recordAuthEvent(rec: AuthAuditRecord): Promise<void>;
  getLockout(email: string, ip: string): Promise<AccountLockout | null>;
  /** How many distinct addresses are locked against this email right now (SEC-001 backstop). */
  getEmailWideLockout(
    email: string,
    now?: Date,
  ): Promise<{ locked_addresses: number; locked_until: string | null }>;
  upsertLockout(
    email: string,
    ip: string,
    state: {
      failed_count: number;
      locked_until: string | null;
      last_failed_at: string | null;
    },
  ): Promise<void>;
}
