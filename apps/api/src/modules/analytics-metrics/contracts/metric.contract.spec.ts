import type { MetricResult, MetricQuery } from './metric.contract';

describe('metric.contract', () => {
  it('MetricResult envelope shape is constructible', () => {
    const r: MetricResult = {
      metric: 'mrr',
      unit: 'cents',
      total: 1000,
      series: [{ bucket: '2026-07-01', value: 1000 }],
      delta: null,
      meta: { computedAt: new Date().toISOString(), tier: 'live' },
    };
    expect(r.total).toBe(1000);
    expect(r.meta.tier).toBe('live');
  });

  it('MetricQuery requires from/to/grain', () => {
    const q: MetricQuery = {
      from: '2026-07-01',
      to: '2026-07-31',
      grain: 'day',
    };
    expect(q.grain).toBe('day');
  });
});
