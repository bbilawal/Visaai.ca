import { shapeDashboard } from './dashboard';
import type { AdminDashboardRaw } from '@visaai/types';

function raw(p: Partial<AdminDashboardRaw> = {}): AdminDashboardRaw {
  return {
    usersTotal: 100,
    usersNew: 8,
    consultants: 5,
    appsByStatus: { draft: 4, ready: 3, submitted: 2, decided: 9 },
    ai: {
      inputTokens: 1000,
      outputTokens: 250,
      requestCostUsd: 1.5,
      billableCostUsd: 2.0,
    },
    paymentsByTier: { self_service: 3, copilot: 1 },
    security: { logins: 40, lockouts: 2 },
    recentActivity: [{ id: 'a1' }],
    dbReachable: true,
    ...p,
  };
}

describe('shapeDashboard', () => {
  it('echoes the range and maps simple sections through', () => {
    const d = shapeDashboard(raw(), '7d');
    expect(d.range).toBe('7d');
    expect(d.users).toEqual({ total: 100, newInRange: 8 });
    expect(d.consultants.total).toBe(5);
    expect(d.security).toEqual({ logins: 40, lockouts: 2 });
    expect(d.recentActivity).toHaveLength(1);
  });

  it('computes applications.inProgress = draft+ready+submitted (excludes decided)', () => {
    const d = shapeDashboard(raw(), '30d');
    expect(d.applications.inProgress).toBe(9); // 4+3+2, not 18
    expect(d.applications.byStatus).toEqual({
      draft: 4,
      ready: 3,
      submitted: 2,
      decided: 9,
    });
  });

  it('sums ai tokens and passes costs', () => {
    const d = shapeDashboard(raw(), '30d');
    expect(d.ai.tokens).toBe(1250); // 1000+250
    expect(d.ai.requestCostUsd).toBe(1.5);
    expect(d.ai.billableCostUsd).toBe(2.0);
  });

  it('reports revenue as labelled volume by tier, never a $ amount', () => {
    const d = shapeDashboard(raw(), '30d');
    expect(d.revenue.completedByTier).toEqual({ self_service: 3, copilot: 1 });
    expect(d.revenue.note.length).toBeGreaterThan(0);
    expect(d.revenue.note).not.toMatch(/\$\d/);
  });

  it('renders honest placeholders for unbuilt subsystems', () => {
    const d = shapeDashboard(raw(), '30d');
    expect(d.subscriptions.available).toBe(false);
    expect(d.supportTickets.available).toBe(false);
    expect(d.subscriptions.reason.length).toBeGreaterThan(0);
    expect(d.supportTickets.reason.length).toBeGreaterThan(0);
  });

  it('reflects dbReachable in systemHealth', () => {
    expect(
      shapeDashboard(raw({ dbReachable: true }), '30d').systemHealth
        .dbReachable,
    ).toBe(true);
    expect(
      shapeDashboard(raw({ dbReachable: false }), '30d').systemHealth
        .dbReachable,
    ).toBe(false);
  });

  it('treats missing in-progress statuses as zero', () => {
    const d = shapeDashboard(raw({ appsByStatus: { decided: 5 } }), '30d');
    expect(d.applications.inProgress).toBe(0);
  });

  it('returns independent copies — mutating output does not affect the original raw input', () => {
    const r = raw();
    const d = shapeDashboard(r, '30d');
    d.applications.byStatus.draft = 999;
    d.security.logins = 999;
    d.revenue.completedByTier.self_service = 999;
    expect(r.appsByStatus.draft).toBe(4);
    expect(r.security.logins).toBe(40);
    expect(r.paymentsByTier.self_service).toBe(3);
  });
});
