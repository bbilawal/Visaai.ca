import { JourneyMetricsService } from './journey-metrics.service';
import { MockKpiSourceRepository } from '../source/mock-kpi-source.repository';

const q = { from: '2026-07-01', to: '2026-07-31', grain: 'month' as const };

describe('JourneyMetricsService', () => {
  it('degrades to stale=0 when activation events are unwired (no rows)', async () => {
    const svc = new JourneyMetricsService(new MockKpiSourceRepository({}));
    const r = await svc.activationFunnel(q);
    expect(r.total).toBe(0);
    expect(r.meta.stale).toBe(true);
  });

  it('computes activation funnel when data present', async () => {
    const src = new MockKpiSourceRepository({
      funnelDaily: [
        {
          day: '2026-07-01',
          funnel: 'activation',
          step: 'signup',
          stepIndex: 0,
          dimKey: '',
          dimVal: '',
          entered: 200,
          converted: 200,
        },
        {
          day: '2026-07-01',
          funnel: 'activation',
          step: 'first_application',
          stepIndex: 1,
          dimKey: '',
          dimVal: '',
          entered: 200,
          converted: 120,
        },
      ],
    });
    const svc = new JourneyMetricsService(src);
    const r: any = await svc.activationFunnel(q);
    expect(r.extra.overallRate).toBeCloseTo(0.6);
    expect(r.meta.stale).toBe(false);
  });
});
