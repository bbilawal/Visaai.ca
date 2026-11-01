import {
  evaluateLimits,
  limitsFor,
  TIER_LIMITS,
  windowEnd,
  windowStart,
  type PartnerLimits,
} from './partner-rate-limit';

const NOW = new Date('2026-08-06T13:47:31.412Z');

describe('limit windows', () => {
  it('truncates the minute window to the minute', () => {
    expect(windowStart('minute', NOW)).toBe('2026-08-06T13:47:00.000Z');
  });

  it('truncates the day window to UTC midnight', () => {
    expect(windowStart('day', NOW)).toBe('2026-08-06T00:00:00.000Z');
  });

  it('truncates the month window to the first of the month', () => {
    expect(windowStart('month', NOW)).toBe('2026-08-01T00:00:00.000Z');
  });

  it('computes window ends', () => {
    expect(windowEnd('minute', NOW).toISOString()).toBe(
      '2026-08-06T13:48:00.000Z',
    );
    expect(windowEnd('day', NOW).toISOString()).toBe(
      '2026-08-07T00:00:00.000Z',
    );
    expect(windowEnd('month', NOW).toISOString()).toBe(
      '2026-09-01T00:00:00.000Z',
    );
  });

  it('rolls the month window across a year boundary', () => {
    const dec = new Date('2026-12-14T09:00:00.000Z');
    expect(windowStart('month', dec)).toBe('2026-12-01T00:00:00.000Z');
    expect(windowEnd('month', dec).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });
});

describe('evaluateLimits', () => {
  const limits: PartnerLimits = { perMinute: 10, perDay: 100, perMonth: 1000 };

  it('allows a request inside every window', () => {
    const decision = evaluateLimits(
      { minute: 5, day: 20, month: 300 },
      limits,
      NOW,
    );
    expect(decision.allowed).toBe(true);
    expect(decision.exceededWindow).toBeNull();
    expect(decision.headers.remaining).toBe(5);
  });

  // The counter is incremented before the check, so `used === limit` is the
  // last allowed request, not the first rejected one.
  it('allows exactly at the limit', () => {
    expect(
      evaluateLimits({ minute: 10, day: 20, month: 300 }, limits, NOW).allowed,
    ).toBe(true);
  });

  it('rejects one past the limit', () => {
    const decision = evaluateLimits(
      { minute: 11, day: 20, month: 300 },
      limits,
      NOW,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.exceededWindow).toBe('minute');
  });

  it('reports remaining as zero when rejected', () => {
    const decision = evaluateLimits(
      { minute: 50, day: 20, month: 300 },
      limits,
      NOW,
    );
    expect(decision.headers.remaining).toBe(0);
  });

  it('sets retry-after to the seconds until the offending window resets', () => {
    const decision = evaluateLimits(
      { minute: 11, day: 20, month: 300 },
      limits,
      NOW,
    );
    // 13:47:31.412 → 13:48:00 is 28.588s, rounded up.
    expect(decision.retryAfterSeconds).toBe(29);
  });

  it('never reports a retry-after below one second', () => {
    const almost = new Date('2026-08-06T13:47:59.999Z');
    const decision = evaluateLimits(
      { minute: 11, day: 20, month: 300 },
      limits,
      almost,
    );
    expect(decision.retryAfterSeconds).toBe(1);
  });

  // Burst-first ordering: telling a client hammering us in a loop about its
  // monthly quota is useless advice.
  it('reports the burst window first when several are exceeded', () => {
    const decision = evaluateLimits(
      { minute: 999, day: 9999, month: 99999 },
      limits,
      NOW,
    );
    expect(decision.exceededWindow).toBe('minute');
  });

  it('reports the day window when only the day is exceeded', () => {
    const decision = evaluateLimits(
      { minute: 1, day: 101, month: 300 },
      limits,
      NOW,
    );
    expect(decision.exceededWindow).toBe('day');
    expect(decision.retryAfterSeconds).toBe(
      Math.ceil(
        (Date.parse('2026-08-07T00:00:00.000Z') - NOW.getTime()) / 1000,
      ),
    );
  });

  it('reports the month window when only the month is exceeded', () => {
    const decision = evaluateLimits(
      { minute: 1, day: 2, month: 1001 },
      limits,
      NOW,
    );
    expect(decision.exceededWindow).toBe('month');
  });

  it('treats a limit of zero as unlimited', () => {
    const unlimited: PartnerLimits = { perMinute: 0, perDay: 0, perMonth: 0 };
    const decision = evaluateLimits(
      { minute: 1e6, day: 1e8, month: 1e9 },
      unlimited,
      NOW,
    );
    expect(decision.allowed).toBe(true);
  });

  it('still enforces the other windows when one is unlimited', () => {
    const mixed: PartnerLimits = { perMinute: 0, perDay: 100, perMonth: 0 };
    expect(
      evaluateLimits({ minute: 1e6, day: 101, month: 0 }, mixed, NOW)
        .exceededWindow,
    ).toBe('day');
  });
});

describe('tier limits', () => {
  it('caps sandbox bursts below the standard live tier', () => {
    expect(TIER_LIMITS.sandbox.perMinute).toBeLessThan(
      TIER_LIMITS.standard.perMinute,
    );
  });

  it('applies the sandbox limits to sandbox regardless of tier', () => {
    expect(limitsFor('enterprise', 'sandbox')).toEqual(TIER_LIMITS.sandbox);
  });

  it('applies tier limits in live', () => {
    expect(limitsFor('scale', 'live')).toEqual(TIER_LIMITS.scale);
  });

  it('falls back to standard for an unknown tier', () => {
    expect(limitsFor('platinum-plus', 'live')).toEqual(TIER_LIMITS.standard);
  });

  it('gives enterprise unlimited live traffic', () => {
    expect(limitsFor('enterprise', 'live')).toEqual({
      perMinute: 0,
      perDay: 0,
      perMonth: 0,
    });
  });
});
