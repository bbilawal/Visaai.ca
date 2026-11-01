import { computeDelta } from './delta';

describe('computeDelta', () => {
  it('percent change vs baseline', () => {
    expect(computeDelta(150, 100)).toEqual({ baseline: 100, pct: 0.5 });
  });
  it('returns null on zero baseline (no Infinity)', () => {
    expect(computeDelta(10, 0)).toBeNull();
  });
  it('negative change', () => {
    expect(computeDelta(80, 100)).toEqual({ baseline: 100, pct: -0.2 });
  });
});
