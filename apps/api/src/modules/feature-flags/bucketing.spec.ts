import { bucketOf, isInRollout } from './bucketing';

describe('feature-flag bucketing', () => {
  it('is deterministic for the same flag and subject', () => {
    const a = bucketOf('payments_enabled', 'user-1');
    const b = bucketOf('payments_enabled', 'user-1');
    expect(a).toBe(b);
  });

  it('produces a bucket in [0, 100)', () => {
    for (let i = 0; i < 500; i++) {
      const b = bucketOf('flag', `user-${i}`);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
  });

  it('gives a subject different buckets for different flags', () => {
    // The property that matters: the same unlucky users must not be the guinea
    // pigs for every experiment at once. Over many flags the buckets for one
    // subject should spread, not cluster on a single value.
    const buckets = new Set(
      Array.from({ length: 50 }, (_, i) => bucketOf(`flag_${i}`, 'user-1')),
    );
    expect(buckets.size).toBeGreaterThan(20);
  });

  describe('isInRollout', () => {
    it('excludes everyone at 0%', () => {
      for (let i = 0; i < 200; i++) {
        expect(isInRollout('f', `user-${i}`, 0)).toBe(false);
      }
    });

    it('includes everyone at 100%', () => {
      for (let i = 0; i < 200; i++) {
        expect(isInRollout('f', `user-${i}`, 100)).toBe(true);
      }
    });

    it('is monotonic — raising the percentage never removes a subject', () => {
      // This is the property that makes a staged rollout safe to advance. If it
      // failed, going 10% → 20% would take the feature away from some users who
      // already had it, which reads to them as a regression.
      const subjects = Array.from({ length: 300 }, (_, i) => `user-${i}`);
      for (let pct = 0; pct < 100; pct++) {
        for (const s of subjects) {
          if (isInRollout('f', s, pct)) {
            expect(isInRollout('f', s, pct + 1)).toBe(true);
          }
        }
      }
    });

    it('lands near the requested share of a population', () => {
      const n = 10_000;
      const included = Array.from({ length: n }, (_, i) =>
        isInRollout('spread_flag', `user-${i}`, 25),
      ).filter(Boolean).length;
      // ±3 points over 10k samples. Wide enough not to be flaky, tight enough
      // that a broken hash (all-one-bucket, or a constant) fails it.
      expect(included / n).toBeGreaterThan(0.22);
      expect(included / n).toBeLessThan(0.28);
    });

    it('clamps out-of-range percentages instead of throwing', () => {
      expect(isInRollout('f', 'u', -10)).toBe(false);
      expect(isInRollout('f', 'u', 250)).toBe(true);
      // Fractional input truncates rather than producing a fractional cut-off.
      expect(isInRollout('f', 'u', 0.9)).toBe(false);
    });
  });
});
