import type {
  LoginHistoryEntry,
  Organization,
  OrganizationInvitation,
  OrganizationMember,
  Permission,
  Role,
  UserAccess,
  UserProfile,
} from '@visaai/types'
import { serverApi } from './server'

// ── server-side ONLY (pages) — pulls next/headers via serverApi. Do NOT import
//    this file from a client component; use ./iam-client instead. ──────────────
export const listMyOrgs = () => serverApi<Organization[]>('/organizations')
export const getOrg = (id: string) =>
  serverApi<Organization>(`/organizations/${id}`)
export const listOrgMembers = (id: string) =>
  serverApi<OrganizationMember[]>(`/organizations/${id}/members`)
export const listOrgInvitations = (id: string) =>
  serverApi<OrganizationInvitation[]>(`/organizations/${id}/invitations`)
export const getMyProfile = () => serverApi<UserProfile | null>('/me/profile')
export const getMyLoginHistory = () =>
  serverApi<LoginHistoryEntry[]>('/me/login-history')
export const getMyAccess = () => serverApi<UserAccess>('/iam/access')
export const listRoles = () => serverApi<Role[]>('/iam/roles')
export const listPermissions = () => serverApi<Permission[]>('/iam/permissions')
