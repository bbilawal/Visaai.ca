import { VisaMetricsService } from './visa-metrics.service';
import { MockKpiSourceRepository } from '../source/mock-kpi-source.repository';

const q = { from: '2026-07-01', to: '2026-07-31', grain: 'month' as const };

describe('VisaMetricsService', () => {
  it('approval funnel returns steps + overall rate in extra', async () => {
    const src = new MockKpiSourceRepository({
      funnelDaily: [
        {
          day: '2026-07-01',
          funnel: 'approval',
          step: 'submitted',
          stepIndex: 0,
          dimKey: '',
          dimVal: '',
          entered: 100,
          converted: 100,
        },
        {
          day: '2026-07-01',
          funnel: 'approval',
          step: 'approved',
          stepIndex: 1,
          dimKey: '',
          dimVal: '',
          entered: 100,
          converted: 70,
        },
      ],
    });
    const svc = new VisaMetricsService(src);
    const r: any = await svc.approvalFunnel(q);
    expect(r.extra.overallRate).toBeCloseTo(0.7);
    expect(r.extra.steps).toHaveLength(2);
    expect(r.meta.tier).toBe('rollup');
  });

  it('rejects an unsupported filter (plan)', async () => {
    const svc = new VisaMetricsService(new MockKpiSourceRepository({}));
    await expect(
      svc.approvalFunnel({ ...q, filters: { plan: 'pro' } }),
    ).rejects.toThrow(/does not support/);
  });
});
