import type {
  Organization,
  OrganizationInvitation,
  OrgMemberRole,
  RoleKey,
  UserProfile,
} from '@visaai/types'
import { apiFetch } from './client'

/**
 * Client-safe IAM actions. Uses apiFetch ONLY (no server.ts / next/headers), so
 * it is importable from client components. The backend re-checks authorization
 * (JwtGuard + PermissionsGuard + org-scoped service checks) — this is not a
 * security boundary.
 */
export const createOrg = (token: string, name: string) =>
  apiFetch<Organization>('/organizations', token, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })

export const updateOrg = (
  token: string,
  id: string,
  patch: Partial<Pick<Organization, 'name' | 'plan' | 'settings'>>,
) =>
  apiFetch<Organization>(`/organizations/${id}`, token, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

export const inviteMember = (
  token: string,
  id: string,
  email: string,
  role: OrgMemberRole,
) =>
  apiFetch<OrganizationInvitation>(`/organizations/${id}/invitations`, token, {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  })

export const revokeInvitation = (token: string, id: string, invId: string) =>
  apiFetch<{ revoked: true }>(
    `/organizations/${id}/invitations/${invId}`,
    token,
    { method: 'DELETE' },
  )

export const updateMember = (
  token: string,
  id: string,
  userId: string,
  patch: { role?: OrgMemberRole; status?: 'active' | 'suspended' },
) =>
  apiFetch<{ updated: true }>(`/organizations/${id}/members/${userId}`, token, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

export const removeMember = (token: string, id: string, userId: string) =>
  apiFetch<{ removed: true }>(`/organizations/${id}/members/${userId}`, token, {
    method: 'DELETE',
  })

export const acceptInvitation = (token: string, inviteToken: string) =>
  apiFetch<{ accepted: true; organization_id: string }>(
    '/organizations/invitations/accept',
    token,
    { method: 'POST', body: JSON.stringify({ token: inviteToken }) },
  )

export const updateProfile = (
  token: string,
  patch: Partial<Omit<UserProfile, 'user_id' | 'created_at' | 'updated_at'>>,
) =>
  apiFetch<UserProfile>('/me/profile', token, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

export const grantRole = (
  token: string,
  userId: string,
  roleKey: RoleKey,
  organizationId?: string | null,
) =>
  apiFetch<{ granted: true; role: RoleKey }>(
    `/iam/users/${userId}/roles`,
    token,
    { method: 'POST', body: JSON.stringify({ roleKey, organizationId }) },
  )

export const recordMfaEvent = (
  token: string,
  event: 'mfa_enabled' | 'mfa_disabled',
) =>
  apiFetch<{ recorded: true }>('/me/mfa/event', token, {
    method: 'POST',
    body: JSON.stringify({ event }),
  })

export const revokeRole = (token: string, userId: string, roleKey: RoleKey) =>
  apiFetch<{ revoked: true; role: RoleKey }>(
    `/iam/users/${userId}/roles/${roleKey}`,
    token,
    { method: 'DELETE' },
  )
