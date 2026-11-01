import { RetentionMetricsService } from './retention-metrics.service';
import { MockKpiSourceRepository } from '../source/mock-kpi-source.repository';

const q = { from: '2026-07-01', to: '2026-07-31', grain: 'month' as const };

describe('RetentionMetricsService', () => {
  it('churn reads the pre-deduped churn_total rollup', async () => {
    const src = new MockKpiSourceRepository({
      metricDaily: [
        {
          metric: 'churn_total',
          day: '2026-07-10',
          dimKey: '',
          dimVal: '',
          value: 4,
        },
        {
          metric: 'churn_total',
          day: '2026-07-20',
          dimKey: '',
          dimVal: '',
          value: 2,
        },
      ],
    });
    const svc = new RetentionMetricsService(src);
    const r = await svc.churn(q);
    expect(r.total).toBe(6);
    expect(r.unit).toBe('count');
    expect(r.meta.tier).toBe('rollup');
  });

  it('churn rate = churned / active_at_start', async () => {
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
    const svc = new RetentionMetricsService(src);
    const r = await svc.churnRate(q);
    expect(r.unit).toBe('ratio');
    expect(r.total).toBeCloseTo(0.05);
  });

  it('LTV = ARPU / churn_rate (derived)', async () => {
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
    const svc = new RetentionMetricsService(src);
    const r = await svc.ltv({ ...q, arpuCents: 5000 });
    expect(r.total).toBe(100000); // 5000 / 0.05
    expect(r.meta.tier).toBe('derived');
  });

  it('NRR = retained_cents / starting cohort cents', async () => {
    const src = new MockKpiSourceRepository({
      retentionCohort: [
        {
          cohortMonth: '2026-06-01',
          periodIndex: 0,
          dimKey: '',
          dimVal: '',
          cohortSize: 10,
          retained: 10,
          retainedCents: 100000,
        },
        {
          cohortMonth: '2026-06-01',
          periodIndex: 1,
          dimKey: '',
          dimVal: '',
          cohortSize: 10,
          retained: 8,
          retainedCents: 90000,
        },
      ],
    });
    const svc = new RetentionMetricsService(src);
    const r = await svc.nrr({
      from: '2026-06-01',
      to: '2026-07-31',
      grain: 'month',
    });
    expect(r.total).toBeCloseTo(0.9);
    expect(r.unit).toBe('ratio');
  });
});
