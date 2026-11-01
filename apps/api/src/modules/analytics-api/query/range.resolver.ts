export type RangePreset =
  | 'last_7d'
  | 'last_30d'
  | 'mtd'
  | 'wtd'
  | 'last_quarter';
export interface SavedQuery {
  from?: string;
  to?: string;
  rangePreset?: RangePreset;
  grain: 'day' | 'week' | 'month';
  filters?: unknown;
  metric?: string;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function resolveRange(
  q: SavedQuery,
  now: Date,
): { from: string; to: string } {
  if (q.from && q.to) return { from: q.from, to: q.to };
  const to = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const from = new Date(to);
  switch (q.rangePreset) {
    case 'last_7d':
      from.setUTCDate(to.getUTCDate() - 6);
      break;
    case 'last_30d':
      from.setUTCDate(to.getUTCDate() - 29);
      break;
    case 'mtd':
      from.setUTCDate(1);
      break;
    case 'wtd':
      from.setUTCDate(to.getUTCDate() - ((to.getUTCDay() + 6) % 7));
      break;
    case 'last_quarter':
      from.setUTCMonth(to.getUTCMonth() - 3);
      break;
    default:
      from.setUTCDate(to.getUTCDate() - 29);
  }
  return { from: iso(from), to: iso(to) };
}
