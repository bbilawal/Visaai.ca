import { BillingAnalyticsService } from './billing-analytics.service';
import { monthlyEquivCents } from '../subscriptions/subscription.constants';

function repo(over: any = {}) {
  return {
    listActiveSubscriptions: jest.fn().mockResolvedValue([]),
    listPastDueSubscriptions: jest.fn().mockResolvedValue([]),
    listRefunds: jest.fn().mockResolvedValue([]),
    ...over,
  };
}
const reports = (over: any = {}) => ({
  report: jest.fn().mockResolvedValue({
    summary: {
      collectedCents: 39900,
      refundedCents: 5000,
      netCents: 34900,
      count: 2,
    },
  }),
  ...over,
});

describe('monthlyEquivCents', () => {
  it('monthly = list price; annual = annual/12', () => {
    expect(monthlyEquivCents('pro', 'month')).toBe(4900);
    expect(monthlyEquivCents('pro', 'year')).toBe(Math.round(49000 / 12));
  });
});

describe('BillingAnalyticsService', () => {
  it('subscriptionMetrics computes MRR, ARR, by-plan', async () => {
    const r = repo({
      listActiveSubscriptions: jest.fn().mockResolvedValue([
        { plan: 'base', billing_interval: 'month' }, // 1500
        { plan: 'pro', billing_interval: 'month' }, // 4900
        { plan: 'premium', billing_interval: 'year' }, // 99000/12 = 8250
      ]),
    });
    const svc = new BillingAnalyticsService(r, reports());
    const m = await svc.subscriptionMetrics();
    expect(m.active).toBe(3);
    expect(m.byPlan).toEqual({ base: 1, pro: 1, premium: 1 });
    expect(m.mrrCents).toBe(1500 + 4900 + Math.round(99000 / 12));
    expect(m.arrCents).toBe(m.mrrCents * 12);
  });

  it('outstanding sums monthly-equiv of past_due subs', async () => {
    const r = repo({
      listPastDueSubscriptions: jest.fn().mockResolvedValue([
        { plan: 'base', billing_interval: 'month' },
        { plan: 'pro', billing_interval: 'month' },
      ]),
    });
    const svc = new BillingAnalyticsService(r, reports());
    expect(await svc.outstanding()).toEqual({
      count: 2,
      amountCents: 1500 + 4900,
    });
  });

  it('revenueCsv renders summary + breakdown rows', async () => {
    const rep = reports({
      report: jest.fn().mockResolvedValue({
        summary: {
          collectedCents: 39900,
          refundedCents: 5000,
          netCents: 34900,
          count: 2,
        },
        breakdown: [
          { key: 'CA', netCents: 25000 },
          { key: 'US', netCents: 9900 },
        ],
      }),
    });
    const svc = new BillingAnalyticsService(repo(), rep);
    const csv = await svc.revenueCsv('2026-01-01', '2027-01-01', 'country');
    expect(csv).toContain('net,,34900');
    expect(csv).toContain('net_by_country,CA,25000');
    expect(csv).toContain('net_by_country,US,9900');
  });
});
