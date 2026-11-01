import { apiFetch } from './client'
import type { AppRole } from './me'
import type { AdminUser } from './admin'
import type { BulkAction, BulkActionResult } from '@visaai/types'

type LifecycleResult = { id: string; status: string }

// ── Phase 2 user lifecycle (all admin-guarded server-side) ──
export const suspendUser = (token: string, id: string, reason?: string) =>
  apiFetch<LifecycleResult>(`/admin/users/${id}/suspend`, token, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
export const reactivateUser = (token: string, id: string) =>
  apiFetch<LifecycleResult>(`/admin/users/${id}/reactivate`, token, { method: 'POST' })
export const softDeleteUser = (token: string, id: string, reason?: string) =>
  apiFetch<LifecycleResult>(`/admin/users/${id}/soft-delete`, token, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
export const restoreUser = (token: string, id: string) =>
  apiFetch<LifecycleResult>(`/admin/users/${id}/restore`, token, { method: 'POST' })
export const resetUserPassword = (token: string, id: string) =>
  apiFetch<{ issued: boolean }>(`/admin/users/${id}/reset-password`, token, { method: 'POST' })
export const bulkUsers = (
  token: string,
  action: BulkAction,
  ids: string[],
  reason?: string,
) =>
  apiFetch<BulkActionResult>(`/admin/users/bulk`, token, {
    method: 'POST',
    body: JSON.stringify({ action, ids, reason }),
  })

// ── IAM role grant/revoke (roles editor) ──
export const grantUserRole = (token: string, id: string, roleKey: string) =>
  apiFetch<{ granted: true }>(`/iam/users/${id}/roles`, token, {
    method: 'POST',
    body: JSON.stringify({ roleKey }),
  })
export const revokeUserRole = (token: string, id: string, roleKey: string) =>
  apiFetch<{ revoked: true }>(`/iam/users/${id}/roles/${encodeURIComponent(roleKey)}`, token, {
    method: 'DELETE',
  })

/**
 * Client-safe admin action. Uses apiFetch ONLY (no server.ts / next/headers),
 * so it is importable from client components. The backend re-checks the admin
 * role server-side (RolesGuard) — this is not a security boundary.
 */
export const setUserRole = (token: string, userId: string, role: AppRole) =>
  apiFetch<AdminUser>(`/admin/users/${userId}/role`, token, {
    method: 'POST',
    body: JSON.stringify({ role }),
  })

/**
 * Consultant country scope (ISO-2 codes). The backend owns the strict
 * country-eligibility rule — an empty set means the consultant sees nothing.
 * Both calls are admin-guarded server-side (RolesGuard); UI is not a boundary.
 */
export const getConsultantCountries = (token: string, userId: string) =>
  apiFetch<{ codes: string[] }>(`/admin/users/${userId}/countries`, token)

export const setConsultantCountries = (
  token: string,
  userId: string,
  codes: string[],
) =>
  apiFetch<{ codes: string[] }>(`/admin/users/${userId}/countries`, token, {
    method: 'PUT',
    body: JSON.stringify({ codes }),
  })
