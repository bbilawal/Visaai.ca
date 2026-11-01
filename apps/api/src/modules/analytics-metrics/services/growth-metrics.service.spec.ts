import { GrowthMetricsService } from './growth-metrics.service';
import { MockKpiSourceRepository } from '../source/mock-kpi-source.repository';

const q = { from: '2026-07-01', to: '2026-07-02', grain: 'day' as const };

describe('GrowthMetricsService', () => {
  it('DAU reads analytics_daily_active rollup (reuse SP-A)', async () => {
    const src = new MockKpiSourceRepository({
      dailyActive: [
        { day: '2026-07-01', dau: 10, wau: 40, mau: 100 },
        { day: '2026-07-02', dau: 12, wau: 44, mau: 105 },
      ],
    });
    const svc = new GrowthMetricsService(src);
    const r = await svc.dau(q);
    expect(r.series).toEqual([
      { bucket: '2026-07-01', value: 10 },
      { bucket: '2026-07-02', value: 12 },
    ]);
    expect(r.meta.tier).toBe('rollup');
  });

  it('MAU returns latest-day value as total (point-in-time, not summed)', async () => {
    const src = new MockKpiSourceRepository({
      dailyActive: [
        { day: '2026-07-01', dau: 10, wau: 40, mau: 100 },
        { day: '2026-07-02', dau: 12, wau: 44, mau: 105 },
      ],
    });
    const svc = new GrowthMetricsService(src);
    const r = await svc.mau(q);
    expect(r.total).toBe(105);
  });
});
