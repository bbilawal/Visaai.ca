import { apiFetch } from './client'
import {
  adminAddBackupPath,
  adminAssignPath,
  adminPromotePath,
  adminReassignPath,
  adminRemoveBackupPath,
  adminSetDeadlinePath,
  adminUnassignPath,
  selfAssignPath,
  selfCompletePath,
} from './assignment-paths'

/**
 * Client-safe assignment mutations (importable from client components). Uses
 * apiFetch ONLY. The backend enforces role + country-eligibility + concurrency
 * (RolesGuard + AssignmentService + DB unique index → 409); these calls are a
 * thin transport, never a security or business-logic boundary. Path builders
 * live in ./assignment-paths (pure, unit-tested).
 */
export {
  selfAssignPath,
  adminAssignPath,
  adminReassignPath,
  adminUnassignPath,
  adminAddBackupPath,
  adminRemoveBackupPath,
  adminPromotePath,
  adminSetDeadlinePath,
  selfCompletePath,
} from './assignment-paths'

/** Consultant claims an eligible unassigned application. */
export const selfAssign = (token: string, applicationId: string) =>
  apiFetch<unknown>(selfAssignPath(applicationId), token, { method: 'POST' })

/** Admin assigns an unassigned application to a consultant. */
export const adminAssign = (token: string, applicationId: string, consultantId: string) =>
  apiFetch<unknown>(adminAssignPath(applicationId), token, {
    method: 'POST',
    body: JSON.stringify({ consultantId }),
  })

/** Admin reassigns to a new consultant (release old + assign new). */
export const adminReassign = (token: string, applicationId: string, consultantId: string) =>
  apiFetch<unknown>(adminReassignPath(applicationId), token, {
    method: 'POST',
    body: JSON.stringify({ consultantId }),
  })

/** Admin removes ownership → application returns to UNASSIGNED. */
export const adminUnassign = (token: string, applicationId: string) =>
  apiFetch<unknown>(adminUnassignPath(applicationId), token, { method: 'POST' })

/** Admin adds a BACKUP consultant (full-access coverage). */
export const adminAddBackup = (token: string, applicationId: string, consultantId: string) =>
  apiFetch<unknown>(adminAddBackupPath(applicationId), token, {
    method: 'POST',
    body: JSON.stringify({ consultantId }),
  })

/** Admin removes a BACKUP consultant. */
export const adminRemoveBackup = (token: string, applicationId: string, consultantId: string) =>
  apiFetch<unknown>(adminRemoveBackupPath(applicationId, consultantId), token, {
    method: 'DELETE',
  })

/** Admin promotes an active backup to primary. */
export const adminPromote = (token: string, applicationId: string, consultantId: string) =>
  apiFetch<unknown>(adminPromotePath(applicationId), token, {
    method: 'POST',
    body: JSON.stringify({ consultantId }),
  })

/**
 * Admin sets/overrides the consultant review deadline. Accepts EXACTLY ONE of:
 *   - `{ hours }` (1..720): due_at = now + hours (back-compat).
 *   - `{ dueAt }` (ISO): an absolute deadline (must be > now+5m, < now+1y).
 * The backend (admin.controller) routes to the matching service method and owns
 * all validation; this is thin transport. Returns the resolved `{ due_at }`.
 */
export const adminSetDeadline = (
  token: string,
  applicationId: string,
  arg: { hours: number } | { dueAt: string },
) =>
  apiFetch<{ due_at: string }>(adminSetDeadlinePath(applicationId), token, {
    method: 'POST',
    body: JSON.stringify(arg),
  })

/** Assigned consultant marks their review complete (stops the SLA clock). */
export const selfComplete = (token: string, applicationId: string) =>
  apiFetch<{ completed_at: string }>(selfCompletePath(applicationId), token, {
    method: 'POST',
  })
