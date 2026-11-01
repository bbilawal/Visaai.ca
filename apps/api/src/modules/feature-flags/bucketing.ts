import { createHash } from 'node:crypto';

/**
 * Deterministic percentage bucketing.
 *
 * A percentage rollout is only useful if it is *stable*: a user who sees a
 * feature at 10% must keep seeing it at 20%, and must see the same answer on
 * web and mobile and on every request in between. Random sampling per request
 * would flicker the UI and make bug reports irreproducible.
 *
 * So: bucket = sha256(flagKey + ':' + subjectId) mod 100, and the subject is
 * IN when bucket < rolloutPercentage.
 *
 * Two properties this buys, both of which are tested:
 *
 *   * Monotonic. Raising the percentage only ever adds subjects — nobody who
 *     had the feature loses it, because their bucket does not move. That is
 *     what makes a staged rollout safe to advance.
 *   * Independent across flags. The flag key is part of the hash input, so a
 *     user is not systematically in the low bucket for every flag at once. If
 *     the subject id alone were hashed, the same unlucky 10% would be the
 *     guinea pigs for every experiment simultaneously.
 *
 * sha256 rather than a fast non-cryptographic hash: this runs at most once per
 * flag per cache miss, so the cost is irrelevant, and sha256's uniformity is
 * already established. Reading the first 4 bytes as an unsigned int gives ~4.29e9
 * values; `% 100` leaves a bias below 1e-8 percentage points, far under the
 * resolution of a whole-percent rollout.
 */
export function bucketOf(flagKey: string, subjectId: string): number {
  const digest = createHash('sha256')
    .update(`${flagKey}:${subjectId}`)
    .digest();
  return digest.readUInt32BE(0) % 100;
}

/**
 * `percentage` is clamped rather than validated: the column is already
 * constrained to 0–100, and an out-of-range value arriving from anywhere else
 * should degrade to the nearest sane rollout, not throw inside request handling.
 *
 * Note the strict `<`: at 0 nobody matches (bucket 0 is not < 0) and at 100
 * everybody does (max bucket 99 < 100). Both edges are covered by tests.
 */
export function isInRollout(
  flagKey: string,
  subjectId: string,
  percentage: number,
): boolean {
  const pct = Math.max(0, Math.min(100, Math.trunc(percentage)));
  if (pct <= 0) return false;
  if (pct >= 100) return true;
  return bucketOf(flagKey, subjectId) < pct;
}
