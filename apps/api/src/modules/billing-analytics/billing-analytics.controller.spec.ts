import { BadRequestException } from '@nestjs/common';
import { BillingAnalyticsController } from './billing-analytics.controller';

function ctl() {
  const svc = {
    subscriptionMetrics: jest.fn().mockResolvedValue({
      active: 3,
      byPlan: { base: 1, pro: 1, premium: 1 },
      mrrCents: 14650,
      arrCents: 175800,
    }),
    outstanding: jest.fn().mockResolvedValue({ count: 1, amountCents: 4900 }),
    listRefunds: jest.fn().mockResolvedValue([{ id: 'ref_1' }]),
    revenueCsv: jest.fn().mockResolvedValue('metric,key,value_cents\n'),
  } as any;
  return { c: new BillingAnalyticsController(svc), svc };
}

describe('BillingAnalyticsController', () => {
  it('subscriptions delegates', async () => {
    const { c } = ctl();
    expect((await c.subscriptions()).active).toBe(3);
  });
  it('revenueCsv requires from + to', () => {
    const { c } = ctl();
    expect(() => c.revenueCsv('', '', undefined)).toThrow(BadRequestException);
  });
  it('revenueCsv delegates when range provided', async () => {
    const { c, svc } = ctl();
    await c.revenueCsv('2026-01-01', '2027-01-01', 'country');
    expect(svc.revenueCsv).toHaveBeenCalledWith(
      '2026-01-01',
      '2027-01-01',
      'country',
    );
  });
});
