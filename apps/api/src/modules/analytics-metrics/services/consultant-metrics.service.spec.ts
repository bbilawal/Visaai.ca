import { ConsultantMetricsService } from './consultant-metrics.service';
import { MockKpiSourceRepository } from '../source/mock-kpi-source.repository';

const q = { from: '2026-07-01', to: '2026-07-31', grain: 'month' as const };

describe('ConsultantMetricsService', () => {
  it('take-rate = platform_fee / gross (commission rules canonical, COR-1)', async () => {
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
    const svc = new ConsultantMetricsService(src);
    const r = await svc.takeRate(q);
    expect(r.unit).toBe('ratio');
    expect(r.total).toBeCloseTo(0.2); // fee 20000 / gross 100000
  });

  it('leaderboard returns top payout by consultant_id', async () => {
    const src = new MockKpiSourceRepository({
      metricDaily: [
        {
          metric: 'consultant_payout',
          day: '2026-07-10',
          dimKey: 'consultant_id',
          dimVal: 'c_1',
          value: 5000,
        },
        {
          metric: 'consultant_payout',
          day: '2026-07-11',
          dimKey: 'consultant_id',
          dimVal: 'c_2',
          value: 9000,
        },
      ],
    });
    const svc = new ConsultantMetricsService(src);
    const r = await svc.leaderboard(q);
    expect(r.byDimension?.[0]).toEqual({ key: 'c_2', value: 9000 });
  });
});
