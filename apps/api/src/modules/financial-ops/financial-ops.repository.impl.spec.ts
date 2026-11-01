import { FinancialOpsRepository } from './financial-ops.repository.impl';

function sb(over: any) {
  return { admin: { from: jest.fn((t: string) => over[t]) } } as any;
}

describe('FinancialOpsRepository', () => {
  it('markRefunded sets status refunded by PI and returns payment id', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({ data: { id: 'pay_1' } });
    const repo = new FinancialOpsRepository(
      sb({
        payments: {
          update: () => ({ eq: () => ({ select: () => ({ maybeSingle }) }) }),
        },
      }),
    );
    expect(await repo.markRefunded('pi_1')).toEqual({ paymentId: 'pay_1' });
  });

  it('findServiceOrderByPI resolves order + payout transfer id', async () => {
    const repo = new FinancialOpsRepository(
      sb({
        consultant_service_orders: {
          select: () => ({
            eq: () => ({ maybeSingle: () => ({ data: { id: 'ord_1' } }) }),
          }),
        },
        consultant_payout_items: {
          select: () => ({
            eq: () => ({
              maybeSingle: () => ({ data: { payout_id: 'po_1' } }),
            }),
          }),
        },
        consultant_payouts: {
          select: () => ({
            eq: () => ({
              maybeSingle: () => ({ data: { stripe_transfer_id: 'tr_1' } }),
            }),
          }),
        },
      }),
    );
    expect(await repo.findServiceOrderByPI('pi_1')).toEqual({
      id: 'ord_1',
      transferId: 'tr_1',
    });
  });

  it('revenueSummary computes net = collected - refunded', async () => {
    const rows = [
      {
        amount_cents: 30000,
        status: 'complete',
        country_code: 'CA',
        visa_type: 'trv',
        plan_tier: null,
        feature: 'processing_fee',
      },
      {
        amount_cents: 5000,
        status: 'refunded',
        country_code: 'CA',
        visa_type: 'trv',
        plan_tier: null,
        feature: 'processing_fee',
      },
      {
        amount_cents: 9900,
        status: 'complete',
        country_code: 'US',
        visa_type: 'b1',
        plan_tier: null,
        feature: 'addon',
      },
    ];
    const repo = new FinancialOpsRepository(
      sb({
        payments: {
          select: () => ({ gte: () => ({ lt: () => ({ data: rows }) }) }),
        },
      }),
    );
    const s = await repo.revenueSummary('2026-01-01', '2027-01-01');
    expect(s).toEqual({
      collectedCents: 39900,
      refundedCents: 5000,
      netCents: 34900,
      count: 2,
    });
  });

  it('revenueByDimension groups net by dimension', async () => {
    const rows = [
      {
        amount_cents: 30000,
        status: 'complete',
        country_code: 'CA',
        visa_type: null,
        plan_tier: null,
        feature: null,
      },
      {
        amount_cents: 5000,
        status: 'refunded',
        country_code: 'CA',
        visa_type: null,
        plan_tier: null,
        feature: null,
      },
      {
        amount_cents: 9900,
        status: 'complete',
        country_code: 'US',
        visa_type: null,
        plan_tier: null,
        feature: null,
      },
    ];
    const repo = new FinancialOpsRepository(
      sb({
        payments: {
          select: () => ({ gte: () => ({ lt: () => ({ data: rows }) }) }),
        },
      }),
    );
    const r = await repo.revenueByDimension(
      '2026-01-01',
      '2027-01-01',
      'country',
    );
    expect(r).toEqual(
      expect.arrayContaining([
        { key: 'CA', netCents: 25000 },
        { key: 'US', netCents: 9900 },
      ]),
    );
  });
});
