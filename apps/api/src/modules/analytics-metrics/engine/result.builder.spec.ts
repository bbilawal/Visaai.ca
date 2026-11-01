import { buildResult, isStale } from './result.builder';

describe('buildResult', () => {
  it('sums total, builds zero-filled series, sets tier', () => {
    const r = buildResult({
      metric: 'mrr',
      unit: 'cents',
      tier: 'rollup',
      rows: [
        { day: '2026-07-01', value: 1000 },
        { day: '2026-07-02', value: 500 },
      ],
      from: '2026-07-01',
      to: '2026-07-02',
      grain: 'day',
    });
    expect(r.total).toBe(1500);
    expect(r.series).toHaveLength(2);
    expect(r.meta.tier).toBe('rollup');
    expect(r.delta).toBeUndefined();
  });

  it('computes delta from baselineRows', () => {
    const r = buildResult({
      metric: 'mrr',
      unit: 'cents',
      tier: 'rollup',
      rows: [{ day: '2026-07-01', value: 150 }],
      baselineRows: [{ day: '2026-06-01', value: 100 }],
      from: '2026-07-01',
      to: '2026-07-01',
      grain: 'day',
    });
    expect(r.delta).toEqual({ baseline: 100, pct: 0.5 });
  });
});

describe('isStale', () => {
  it('same-day within SLA is not stale; null is always stale', () => {
    expect(isStale('2026-07-09', 15, new Date('2026-07-09T12:20:00Z'))).toBe(
      false,
    );
    expect(isStale(null, 15, new Date('2026-07-09T12:00:00Z'))).toBe(true);
  });
});
