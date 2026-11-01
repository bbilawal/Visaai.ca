import { bucketize } from './bucketing';

describe('bucketize', () => {
  it('zero-fills missing days across the range', () => {
    const out = bucketize(
      [{ day: '2026-07-02', value: 5 }],
      '2026-07-01',
      '2026-07-03',
      'day',
    );
    expect(out).toEqual([
      { bucket: '2026-07-01', value: 0 },
      { bucket: '2026-07-02', value: 5 },
      { bucket: '2026-07-03', value: 0 },
    ]);
  });

  it('sums into month buckets keyed YYYY-MM-01', () => {
    const out = bucketize(
      [
        { day: '2026-07-05', value: 2 },
        { day: '2026-07-20', value: 3 },
        { day: '2026-08-01', value: 4 },
      ],
      '2026-07-01',
      '2026-08-31',
      'month',
    );
    expect(out).toEqual([
      { bucket: '2026-07-01', value: 5 },
      { bucket: '2026-08-01', value: 4 },
    ]);
  });

  it('week buckets start Monday', () => {
    // 2026-07-01 is a Wednesday; its Monday is 2026-06-29
    const out = bucketize(
      [{ day: '2026-07-01', value: 1 }],
      '2026-07-01',
      '2026-07-01',
      'week',
    );
    expect(out[0].bucket).toBe('2026-06-29');
  });
});
