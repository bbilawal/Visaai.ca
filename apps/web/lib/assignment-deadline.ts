/**
 * Pure formatters for the consultant review SLA (due_at / completed_at). No
 * React, no i18n deps → trivially unit-testable and shared by the consultant,
 * admin, and applicant views. English-only labels, consistent with the rest of
 * the assignment UI (see admin-assignment-controls "+ Backup" precedent).
 */

export type DeadlineState = 'completed' | 'overdue' | 'due' | 'none'

export interface DeadlineInfo {
  state: DeadlineState
  /** Short human label, e.g. "Completed", "Overdue", "Due in 5h", "Due in 20m". */
  label: string
}

/** Round-trip a deadline pair into a display state + label. */
export function deadlineInfo(
  dueAt: string | null | undefined,
  completedAt: string | null | undefined,
  now: number = Date.now(),
): DeadlineInfo {
  if (completedAt) return { state: 'completed', label: 'Completed' }
  if (!dueAt) return { state: 'none', label: '—' }
  const due = Date.parse(dueAt)
  if (Number.isNaN(due)) return { state: 'none', label: '—' }
  const ms = due - now
  if (ms <= 0) return { state: 'overdue', label: 'Overdue' }
  return { state: 'due', label: `Due in ${humanizeMs(ms)}` }
}

/** Compact remaining-time: days, else hours, else minutes (floored, min "1m"). */
function humanizeMs(ms: number): string {
  const mins = Math.floor(ms / 60_000)
  if (mins >= 1440) return `${Math.floor(mins / 1440)}d`
  if (mins >= 60) return `${Math.floor(mins / 60)}h`
  return `${Math.max(1, mins)}m`
}

/** "Self-assigned" vs "Assigned by <email>" vs "Assigned by admin". */
export function assignedByLabel(
  role: 'consultant' | 'admin' | null | undefined,
  email: string | null | undefined,
): string {
  if (role === 'consultant') return 'Self-assigned'
  if (role === 'admin') return email ? `Assigned by ${email}` : 'Assigned by admin'
  return '—'
}
