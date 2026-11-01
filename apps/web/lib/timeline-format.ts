import type { AssignmentEventType } from '@visaai/types'

/**
 * Pure presentation mapping for assignment timeline events: label + icon +
 * tone per event type. No logic beyond a lookup — keeps the viewer dumb and
 * makes the mapping unit-testable.
 */
export interface EventDisplay {
  /** Key into the `timeline` i18n namespace; the viewer resolves it via `t`. */
  labelKey: string
  icon: string
  tone: 'assign' | 'reassign' | 'unassign'
}

const MAP: Record<AssignmentEventType, EventDisplay> = {
  CONSULTANT_SELF_ASSIGNED: { labelKey: 'selfAssigned', icon: '●', tone: 'assign' },
  CONSULTANT_ASSIGNED: { labelKey: 'assigned', icon: '●', tone: 'assign' },
  CONSULTANT_REASSIGNED: { labelKey: 'reassigned', icon: '◐', tone: 'reassign' },
  CONSULTANT_UNASSIGNED: { labelKey: 'unassigned', icon: '○', tone: 'unassign' },
  CONSULTANT_BACKUP_ADDED: { labelKey: 'backupAdded', icon: '＋', tone: 'assign' },
  CONSULTANT_PROMOTED: { labelKey: 'promoted', icon: '▲', tone: 'reassign' },
  CONSULTANT_BACKUP_REMOVED: { labelKey: 'backupRemoved', icon: '－', tone: 'unassign' },
}

const FALLBACK: EventDisplay = { labelKey: 'event', icon: '•', tone: 'assign' }

/** Display config for an event type (fail-safe fallback for unknown types). */
export function eventDisplay(type: AssignmentEventType | string): EventDisplay {
  return MAP[type as AssignmentEventType] ?? FALLBACK
}

const TONE_COLOR: Record<EventDisplay['tone'], string> = {
  assign: 'var(--color-emerald, #1a6b40)',
  reassign: 'var(--color-atmosphere-wash, #4e4d4d)',
  unassign: 'var(--color-rose, #b53030)',
}

/** CSS color for a tone (token-based; works in every styling area). */
export function toneColor(tone: EventDisplay['tone']): string {
  return TONE_COLOR[tone]
}
