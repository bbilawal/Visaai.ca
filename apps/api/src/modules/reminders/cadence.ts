export type ReminderKind = 'stall_3' | 'stall_7' | 'stall_14';

export function reminderKindFor(stalledDays: number): ReminderKind | null {
  if (stalledDays >= 14) return 'stall_14';
  if (stalledDays >= 7) return 'stall_7';
  if (stalledDays >= 3) return 'stall_3';
  return null;
}
