import {
  assessFreshness,
  FRESHNESS_AGING_DAYS,
  FRESHNESS_UNVERIFIED_DAYS,
} from './freshness';

const NOW = new Date('2026-08-13T12:00:00.000Z');
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe('assessFreshness', () => {
  it('is fresh when confirmed today and the row is ok', () => {
    const f = assessFreshness(
      { status: 'ok', lastVerifiedAt: daysAgo(0) },
      NOW,
    );
    expect(f).toEqual({ level: 'fresh', ageDays: 0, verifiedAt: daysAgo(0) });
  });

  it('ages an ok row once it passes the aging threshold', () => {
    expect(
      assessFreshness(
        { status: 'ok', lastVerifiedAt: daysAgo(FRESHNESS_AGING_DAYS - 1) },
        NOW,
      ).level,
    ).toBe('fresh');
    expect(
      assessFreshness(
        { status: 'ok', lastVerifiedAt: daysAgo(FRESHNESS_AGING_DAYS) },
        NOW,
      ).level,
    ).toBe('aging');
  });

  // This is the whole point of the gate. Before it, a row could sit 'stale'
  // forever and delivery would keep presenting a withdrawn government form as
  // the applicant's current one, with only a WARN line as evidence.
  it('stops calling a copy current once it passes the unverified threshold', () => {
    const f = assessFreshness(
      { status: 'ok', lastVerifiedAt: daysAgo(FRESHNESS_UNVERIFIED_DAYS) },
      NOW,
    );
    expect(f.level).toBe('unverified');
    expect(f.ageDays).toBe(FRESHNESS_UNVERIFIED_DAYS);
    // The date is still returned: "we last confirmed this on X" is the honest
    // message, and the UI needs the date to say it.
    expect(f.verifiedAt).toBe(daysAgo(FRESHNESS_UNVERIFIED_DAYS));
  });

  // A stale row is serving PRESERVED bytes — nothing confirmed them on the last
  // run — so it can never read as fresh no matter how recent the last success.
  it('never calls a non-ok row fresh, even when just verified', () => {
    expect(
      assessFreshness({ status: 'stale', lastVerifiedAt: daysAgo(0) }, NOW)
        .level,
    ).toBe('aging');
    expect(
      assessFreshness({ status: 'blocked', lastVerifiedAt: daysAgo(1) }, NOW)
        .level,
    ).toBe('aging');
  });

  it('treats a never-verified row as unverified', () => {
    expect(
      assessFreshness({ status: 'ok', lastVerifiedAt: null }, NOW),
    ).toEqual({ level: 'unverified', ageDays: null, verifiedAt: null });
  });

  it('treats a corrupt timestamp as unverified rather than fresh', () => {
    expect(
      assessFreshness({ status: 'ok', lastVerifiedAt: 'not-a-date' }, NOW)
        .level,
    ).toBe('unverified');
  });

  // Clock skew between Postgres and this process must not produce a negative
  // age, and must certainly not read as "verified in the future".
  it('clamps a future timestamp to zero days', () => {
    const future = new Date(NOW.getTime() + 3_600_000).toISOString();
    const f = assessFreshness({ status: 'ok', lastVerifiedAt: future }, NOW);
    expect(f.ageDays).toBe(0);
    expect(f.level).toBe('fresh');
  });
});
