export type ChurnEvent = {
  subscriptionId: string;
  day: string;
  kind: 'voluntary' | 'involuntary';
};

/**
 * Collapse churn signals to one row per subscription. A subscription can emit both an
 * involuntary signal (payment.failed -> dunning cancel) and a voluntary one
 * (subscription.canceled) in the same period; count it once, voluntary wins.
 * Within the same kind, keep the earliest day.
 */
export function dedupeChurn(events: ChurnEvent[]): ChurnEvent[] {
  const bySub = new Map<string, ChurnEvent>();
  for (const e of events) {
    const cur = bySub.get(e.subscriptionId);
    if (!cur) {
      bySub.set(e.subscriptionId, e);
      continue;
    }
    const eWins = e.kind === 'voluntary' && cur.kind !== 'voluntary';
    const sameKindEarlier = e.kind === cur.kind && e.day < cur.day;
    if (eWins || sameKindEarlier) bySub.set(e.subscriptionId, e);
  }
  return [...bySub.values()];
}
