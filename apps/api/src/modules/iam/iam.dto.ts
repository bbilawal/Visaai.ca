import { z } from 'zod';

const ROLE_KEYS = [
  'applicant',
  'consultant',
  'support_agent',
  'org_admin',
  'platform_admin',
  'super_admin',
] as const;

const ORG_MEMBER_ROLES = ['org_admin', 'member', 'consultant'] as const;

export const GrantRoleDto = z.object({
  roleKey: z.enum(ROLE_KEYS),
  organizationId: z.string().uuid().nullish(),
});

export const CreateOrgDto = z.object({
  name: z.string().min(1).max(120),
});

// SEC-3004: `plan` is intentionally NOT client-settable. Any user who creates
// an org becomes its admin, so accepting `plan` here is a self-service
// billing-tier change. Plan is set only by the billing flow via the
// service-role repository, never through this self-service update.
export const UpdateOrgDto = z
  .object({
    name: z.string().min(1).max(120).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'No fields to update' });

export const InviteMemberDto = z.object({
  email: z.string().email(),
  role: z.enum(ORG_MEMBER_ROLES).default('member'),
});

export const UpdateMemberDto = z
  .object({
    role: z.enum(ORG_MEMBER_ROLES).optional(),
    status: z.enum(['active', 'suspended']).optional(),
  })
  .refine((o) => o.role != null || o.status != null, {
    message: 'role or status required',
  });

export const AcceptInviteDto = z.object({
  token: z.string().min(10),
});

export const UpdateProfileDto = z
  .object({
    first_name: z.string().max(120).nullish(),
    last_name: z.string().max(120).nullish(),
    phone: z.string().max(40).nullish(),
    address_line1: z.string().max(200).nullish(),
    address_line2: z.string().max(200).nullish(),
    city: z.string().max(120).nullish(),
    region: z.string().max(120).nullish(),
    postal_code: z.string().max(40).nullish(),
    country: z.string().length(2).nullish(),
    timezone: z.string().max(64).optional(),
    avatar_url: z.string().url().max(2048).nullish(),
    privacy: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'No fields to update' });

export const MfaEventDto = z.object({
  event: z.enum(['mfa_enabled', 'mfa_disabled']),
});

// Public (pre-auth) security endpoints.
export const LockoutStatusDto = z.object({ email: z.string().email() });
// SEC-1002: `userId` is intentionally NOT accepted from the client — it was
// forgeable into login_history / auth_audit_log. The controller derives userId
// only from a verified Supabase token. Any userId in the body is ignored.
export const RecordLoginDto = z.object({
  email: z.string().email(),
  success: z.boolean(),
});
