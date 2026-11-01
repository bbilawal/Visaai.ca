import { FinancialMetricsService } from '../src/modules/analytics-metrics/services/financial-metrics.service';
import { RetentionMetricsService } from '../src/modules/analytics-metrics/services/retention-metrics.service';
import { ConsultantMetricsService } from '../src/modules/analytics-metrics/services/consultant-metrics.service';
import { MockKpiSourceRepository } from '../src/modules/analytics-metrics/source/mock-kpi-source.repository';

const q = { from: '2026-07-01', to: '2026-07-31', grain: 'month' as const };

describe('analytics accuracy golden', () => {
  it('MRR snapshot === BillingAnalyticsService.mrrCents (reuse, not rebuild)', async () => {
    const billing = {
      subscriptionMetrics: jest.fn().mockResolvedValue({
        active: 3,
        byPlan: {},
        mrrCents: 14700,
        arrCents: 176400,
      }),
      outstanding: jest.fn(),
    } as any;
    const reports = {
      report: jest.fn().mockResolvedValue({ summary: { netCents: 34900 } }),
    } as any;
    const svc = new FinancialMetricsService(
      billing,
      reports,
      new MockKpiSourceRepository({}),
    );
    const r = await svc.mrr(q);
    expect(r.total).toBe((await billing.subscriptionMetrics()).mrrCents);
  });

  it('take-rate = fee/gross exactly (COR-1 commission-rule authority)', async () => {
    const src = new MockKpiSourceRepository({
      metricDaily: [
        {
          metric: 'consultant_gross',
          day: '2026-07-10',
          dimKey: '',
          dimVal: '',
          value: 100000,
        },
        {
          metric: 'consultant_payout',
          day: '2026-07-10',
          dimKey: '',
          dimVal: '',
          value: 80000,
        },
      ],
    });
    const r = await new ConsultantMetricsService(src).takeRate(q);
    expect(r.total).toBeCloseTo(0.2);
  });

  it('churn_rate = churned / active_at_start exactly', async () => {
    const src = new MockKpiSourceRepository({
      metricDaily: [
        {
          metric: 'churn_total',
          day: '2026-07-10',
          dimKey: '',
          dimVal: '',
          value: 5,
        },
        {
          metric: 'active_start',
          day: '2026-07-01',
          dimKey: '',
          dimVal: '',
          value: 100,
        },
      ],
    });
    const r = await new RetentionMetricsService(src).churnRate(q);
    expect(r.total).toBeCloseTo(0.05);
  });
});
