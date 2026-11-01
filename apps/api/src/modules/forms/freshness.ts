/**
 * How old a cached government document is allowed to get before we stop
 * calling it current.
 *
 * WHY THIS EXISTS
 *
 * The delivery paths served any row with status in ('ok','stale') with no age
 * check. `stale` means "cached copy served, last refresh failed" — a state a
 * row can hold FOREVER, because the failure path deliberately preserves the
 * bytes. So a form the government withdrew last year kept being handed to
 * applicants as their current form, and the only trace was a WARN line.
 *
 * Preserving the bytes is still right: a cached copy beats nothing, and most
 * failures are transient. What was missing is honesty about age. So nothing is
 * deleted or withheld here — the download stays available — but past the
 * thresholds the answer carries "we last confirmed this on <date>", and the UI
 * leads with the authority's own page instead of ours.
 *
 * WHY THE CLOCK IS `last_verified_at` AND NOT THE OTHER TWO TIMESTAMPS
 *
 *   last_checked_at  we TRIED. Bumped even when the refresh failed, so it says
 *                    nothing about whether the bytes are current — using it
 *                    would make a row that has failed every night for a year
 *                    look fresh.
 *   fetched_at       the bytes last CHANGED. A form that has not been revised
 *                    in three years is perfectly current with a three-year-old
 *                    fetched_at, so this would condemn correct rows.
 *   last_verified_at we CONFIRMED, changed or unchanged. The only one that
 *                    answers the question.
 */

/** Past this, the answer starts carrying the verification date. */
export const FRESHNESS_AGING_DAYS = 7;

/**
 * Past this, the copy is no longer presented as current.
 *
 * Thirty days is chosen against the refresh cadence, not the revision cadence:
 * the job runs nightly, so a row that has not verified in a month has failed
 * ~30 consecutive times. That is a broken integration, not a slow government —
 * and it is comfortably longer than any transient outage or holiday freeze.
 */
export const FRESHNESS_UNVERIFIED_DAYS = 30;

const DAY_MS = 86_400_000;

export type FreshnessLevel = 'fresh' | 'aging' | 'unverified';

export interface FreshnessInput {
  status: string;
  /** ISO timestamp of the last successful verification, or null. */
  lastVerifiedAt: string | null;
}

export interface Freshness {
  level: FreshnessLevel;
  /** Whole days since the last successful verification; null if never. */
  ageDays: number | null;
  verifiedAt: string | null;
}

/**
 * A row is fresh only while it is BOTH confirmed-current and recently
 * confirmed. A row that has never verified is 'unverified' regardless of age —
 * there is no date to reassure anyone with.
 */
export function assessFreshness(
  input: FreshnessInput,
  now: Date = new Date(),
): Freshness {
  const { status, lastVerifiedAt } = input;

  if (!lastVerifiedAt) {
    return { level: 'unverified', ageDays: null, verifiedAt: null };
  }

  const then = Date.parse(lastVerifiedAt);
  // An unparseable timestamp is corrupt data, not a fresh row. Fail toward the
  // honest answer.
  if (Number.isNaN(then)) {
    return { level: 'unverified', ageDays: null, verifiedAt: null };
  }

  // Clamp at zero: a clock skew between the DB and this process must not read
  // as a negative age and certainly must not read as "verified in the future".
  const ageDays = Math.max(0, Math.floor((now.getTime() - then) / DAY_MS));

  if (ageDays >= FRESHNESS_UNVERIFIED_DAYS) {
    return { level: 'unverified', ageDays, verifiedAt: lastVerifiedAt };
  }
  // 'ok' is the only status that asserts the copy was confirmed on the last
  // run. Anything else ('stale', and defensively any future status) is serving
  // preserved bytes, so it is at best 'aging' no matter how recent the last
  // successful verification was.
  if (status !== 'ok') {
    return { level: 'aging', ageDays, verifiedAt: lastVerifiedAt };
  }
  if (ageDays >= FRESHNESS_AGING_DAYS) {
    return { level: 'aging', ageDays, verifiedAt: lastVerifiedAt };
  }
  return { level: 'fresh', ageDays, verifiedAt: lastVerifiedAt };
}
