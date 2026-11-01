import { FinancialMetricsService } from './financial-metrics.service';
import { MockKpiSourceRepository } from '../source/mock-kpi-source.repository';

const billing = (over: any = {}) => ({
  subscriptionMetrics: jest.fn().mockResolvedValue({
    active: 3,
    byPlan: { pro: 3 },
    mrrCents: 14700,
    arrCents: 176400,
  }),
  outstanding: jest.fn().mockResolvedValue({ count: 1, amountCents: 4900 }),
  ...over,
});
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
const q = { from: '2026-07-01', to: '2026-07-31', grain: 'day' as const };

describe('FinancialMetricsService', () => {
  it('MRR snapshot === BillingAnalyticsService.mrrCents (reuse, not rebuild)', async () => {
    const b = billing();
    const svc = new FinancialMetricsService(
      b,
      reports(),
      new MockKpiSourceRepository({}),
    );
    const r = await svc.mrr(q);
    expect(r.total).toBe(14700);
    expect(r.unit).toBe('cents');
    expect(r.meta.tier).toBe('live');
    expect(b.subscriptionMetrics).toHaveBeenCalledTimes(1);
  });

  it('revenue reads FinancialReportService net', async () => {
    const svc = new FinancialMetricsService(
      billing(),
      reports(),
      new MockKpiSourceRepository({}),
    );
    const r = await svc.revenue(q);
    expect(r.total).toBe(34900);
  });

  it('MRR trend reads kpi_metric_daily rollup', async () => {
    const src = new MockKpiSourceRepository({
      metricDaily: [
        {
          metric: 'mrr',
          day: '2026-07-01',
          dimKey: '',
          dimVal: '',
          value: 14700,
        },
      ],
    });
    const svc = new FinancialMetricsService(billing(), reports(), src);
    const r = await svc.compute({ ...q, metric: 'mrr_trend' } as any);
    expect(r.meta.tier).toBe('rollup');
    expect(r.total).toBe(14700);
  });

  it('rejects unsupported filter', async () => {
    const svc = new FinancialMetricsService(
      billing(),
      reports(),
      new MockKpiSourceRepository({}),
    );
    await expect(
      svc.mrr({ ...q, filters: { visa_type: 'skilled' } }),
    ).rejects.toThrow(/does not support/);
  });

  it('contribution margin = net - consultant payout - ai cost (derived)', async () => {
    const svc = new FinancialMetricsService(
      billing(),
      reports(),
      new MockKpiSourceRepository({}),
      {
        payoutCents: async () => 10000,
        aiCostCents: async () => 2000,
      },
    );
    const r = await svc.margin(q); // net 34900 - 10000 - 2000
    expect(r.total).toBe(22900);
    expect(r.meta.tier).toBe('derived');
  });
});
