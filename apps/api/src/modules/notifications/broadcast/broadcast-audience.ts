import type { BroadcastAudience } from '@visaai/types';

/** Human-readable one-line summary of a broadcast audience (UI + history label). */
export function audienceSummary(a: BroadcastAudience): string {
  switch (a.kind) {
    case 'all':
      return 'All users';
    case 'role':
      return `Role: ${a.role}`;
    case 'users':
      return `${a.userIds.length} specific user${a.userIds.length === 1 ? '' : 's'}`;
  }
}
