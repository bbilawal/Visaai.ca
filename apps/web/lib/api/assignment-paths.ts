/**
 * Pure backend path builders for assignment actions. No imports → trivially
 * unit-testable (run via `pnpm --filter web test:unit`) and shared by the
 * client mutations. Keeping these separate from assignment-client.ts (which
 * pulls in apiFetch) lets the wiring tests run without a bundler.
 */
export const selfAssignPath = (applicationId: string) =>
  `/applications/${applicationId}/consultant/self-assign`
export const adminAssignPath = (applicationId: string) =>
  `/admin/applications/${applicationId}/assign`
export const adminReassignPath = (applicationId: string) =>
  `/admin/applications/${applicationId}/reassign`
export const adminUnassignPath = (applicationId: string) =>
  `/admin/applications/${applicationId}/unassign`
export const adminAddBackupPath = (applicationId: string) =>
  `/admin/applications/${applicationId}/backups`
export const adminRemoveBackupPath = (applicationId: string, consultantId: string) =>
  `/admin/applications/${applicationId}/backups/${consultantId}`
export const adminPromotePath = (applicationId: string) =>
  `/admin/applications/${applicationId}/promote`
export const adminSetDeadlinePath = (applicationId: string) =>
  `/admin/applications/${applicationId}/deadline`
export const selfCompletePath = (applicationId: string) =>
  `/consultant/applications/${applicationId}/complete`
