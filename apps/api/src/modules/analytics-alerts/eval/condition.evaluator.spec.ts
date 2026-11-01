import {
  extractTarget,
  evaluateCondition,
  evaluateRule,
} from './condition.evaluator';

const R: any = {
  metric: 'mrr',
  unit: 'cents',
  total: 84000,
  series: [
    { bucket: 'a', value: 100 },
    { bucket: 'b', value: 40 },
  ],
  byDimension: [{ key: 'pro', value: 300 }],
  delta: { baseline: 100000, pct: -0.16 },
  meta: { computedAt: 'x', tier: 'rollup' },
};

describe('extractTarget', () => {
  it('total / delta_pct / dimension / series aggs', () => {
    expect(extractTarget(R, { kind: 'total' })).toBe(84000);
    expect(extractTarget(R, { kind: 'delta_pct' })).toBeCloseTo(-0.16);
    expect(extractTarget(R, { kind: 'dimension', dimVal: 'pro' })).toBe(300);
    expect(extractTarget(R, { kind: 'series', agg: 'min' })).toBe(40);
    expect(extractTarget(R, { kind: 'series', agg: 'max' })).toBe(100);
    expect(extractTarget(R, { kind: 'series', agg: 'last' })).toBe(40);
    expect(extractTarget(R, { kind: 'series', agg: 'avg' })).toBe(70);
  });
  it('missing dimension / empty series -> null', () => {
    expect(extractTarget(R, { kind: 'dimension', dimVal: 'nope' })).toBeNull();
    expect(
      extractTarget({ ...R, series: [] }, { kind: 'series', agg: 'min' }),
    ).toBeNull();
    expect(
      extractTarget({ ...R, delta: null }, { kind: 'delta_pct' }),
    ).toBeNull();
  });
});

describe('evaluateCondition', () => {
  it('lt breaches when total below value', () => {
    expect(
      evaluateCondition(R, {
        target: { kind: 'total' },
        op: 'lt',
        value: 100000,
      }),
    ).toEqual({ breached: true, actual: 84000 });
  });
  it('null actual is never breached', () => {
    expect(
      evaluateCondition(R, {
        target: { kind: 'dimension', dimVal: 'x' },
        op: 'gt',
        value: 0,
      }),
    ).toEqual({ breached: false, actual: null });
  });
});

describe('evaluateRule', () => {
  it('all: every condition must breach', () => {
    const out = evaluateRule(
      R,
      [
        { target: { kind: 'total' }, op: 'lt', value: 100000 },
        { target: { kind: 'delta_pct' }, op: 'lt', value: -0.1 },
      ],
      'all',
    );
    expect(out.breached).toBe(true);
  });
  it('any: one breach suffices', () => {
    const out = evaluateRule(
      R,
      [
        { target: { kind: 'total' }, op: 'gt', value: 999999 },
        { target: { kind: 'delta_pct' }, op: 'lt', value: -0.1 },
      ],
      'any',
    );
    expect(out.breached).toBe(true);
  });
});
