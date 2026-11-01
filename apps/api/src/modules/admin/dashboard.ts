import type {
  AdminDashboard,
  AdminDashboardRaw,
  DashboardRange,
} from '@visaai/types';

const IN_PROGRESS = ['draft', 'ready', 'submitted'] as const;

/**
 * Pure assembly of the admin dashboard from pre-aggregated raw inputs. No I/O —
 * the service supplies counts/sums; this derives + applies honest placeholders.
 */
export function shapeDashboard(
  raw: AdminDashboardRaw,
  range: DashboardRange,
): AdminDashboard {
  const inProgress = IN_PROGRESS.reduce(
    (sum, s) => sum + (raw.appsByStatus[s] ?? 0),
    0,
  );
  return {
    range,
    users: { total: raw.usersTotal, newInRange: raw.usersNew },
    consultants: { total: raw.consultants },
    applications: { inProgress, byStatus: { ...raw.appsByStatus } },
    ai: {
      tokens: raw.ai.inputTokens + raw.ai.outputTokens,
      requestCostUsd: raw.ai.requestCostUsd,
      billableCostUsd: raw.ai.billableCostUsd,
    },
    revenue: {
      completedByTier: { ...raw.paymentsByTier },
      note: 'Completed order volume by plan tier (count, not a revenue $ amount — payments.amount_cents is sparsely populated for processing-fee rows only and not yet a reliable revenue figure; full reconciliation deferred to PRICE-12).',
    },
    security: { ...raw.security },
    recentActivity: [...raw.recentActivity],
    subscriptions: {
      available: false,
      reason: 'Subscriptions not yet implemented (roadmap M3.1).',
    },
    supportTickets: {
      available: false,
      reason: 'Support tickets not yet implemented (admin phase 8).',
    },
    systemHealth: {
      available: raw.dbReachable,
      dbReachable: raw.dbReachable,
      reason: raw.dbReachable ? undefined : 'Primary database read failed.',
    },
  };
}
