import { AiMetricsService } from './ai-metrics.service';
import { MockKpiSourceRepository } from '../source/mock-kpi-source.repository';

const q = { from: '2026-07-01', to: '2026-07-02', grain: 'day' as const };

describe('AiMetricsService', () => {
  it('AI cost per application reads the matview (live)', async () => {
    const src = new MockKpiSourceRepository({
      aiCost: [
        { day: '2026-07-01', costCents: 250 },
        { day: '2026-07-02', costCents: 300 },
      ],
    });
    const svc = new AiMetricsService(src);
    const r = await svc.costPerApplication(q);
    expect(r.total).toBe(550);
    expect(r.meta.tier).toBe('live');
  });
});
