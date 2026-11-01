import { percentile, summarize } from '../scripts/lt-metrics';

describe('lt-metrics', () => {
  const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; // ascending

  it('percentile: empty array → 0', () => {
    expect(percentile([], 50)).toBe(0);
  });

  it('percentile: single value → that value for any p', () => {
    expect(percentile([7], 50)).toBe(7);
    expect(percentile([7], 99)).toBe(7);
  });

  it('percentile: nearest-rank on a known set', () => {
    expect(percentile(ten, 50)).toBe(5);
    expect(percentile(ten, 95)).toBe(10);
    expect(percentile(ten, 99)).toBe(10);
    expect(percentile(ten, 100)).toBe(10);
  });

  it('summarize: empty → count 0 and all-zero, no NaN', () => {
    const s = summarize([]);
    expect(s).toEqual({
      count: 0,
      min: 0,
      p50: 0,
      p95: 0,
      p99: 0,
      max: 0,
      mean: 0,
    });
  });

  it('summarize: sorts a copy and fills the fields', () => {
    const s = summarize([40, 10, 30, 20]); // unsorted input
    expect(s.count).toBe(4);
    expect(s.min).toBe(10);
    expect(s.max).toBe(40);
    expect(s.p50).toBe(20);
    expect(s.mean).toBe(25);
  });
});
