/**
 * Rate limiting and quota decisions. Pure: the caller supplies the current
 * counts and the clock, this decides. That keeps the policy testable without
 * Redis and makes the store swappable (Redis in production, memory in tests
 * and single-node deploys).
 *
 * Three independent windows, all enforced:
 *   per-minute  — burst protection, the thing that stops a runaway loop
 *   per-day     — fair use
 *   per-month   — the commercial quota
 *
 * A limit of 0 means UNLIMITED, matching the convention the voice module
 * already uses for configured limits. `-1` would be cleverer and worse.
 */

export type LimitWindow = 'minute' | 'day' | 'month';

export interface PartnerLimits {
  perMinute: number;
  perDay: number;
  perMonth: number;
}

export interface WindowUsage {
  minute: number;
  day: number;
  month: number;
}

export interface LimitDecision {
  allowed: boolean;
  /** Which window rejected. Null when allowed. */
  exceededWindow: LimitWindow | null;
  /** Seconds until the offending window resets. 0 when allowed. */
  retryAfterSeconds: number;
  /** Values for the RateLimit-* response headers, always populated. */
  headers: {
    limit: number;
    remaining: number;
    resetAt: string;
  };
}

/** Start of the window containing `now`, as an ISO timestamp. */
export function windowStart(kind: LimitWindow, now: Date): string {
  const d = new Date(now.getTime());
  d.setUTCSeconds(0, 0);
  if (kind === 'minute') return d.toISOString();
  d.setUTCHours(0, 0, 0, 0);
  if (kind === 'day') return d.toISOString();
  d.setUTCDate(1);
  return d.toISOString();
}

/** End of the window containing `now`. */
export function windowEnd(kind: LimitWindow, now: Date): Date {
  const start = new Date(windowStart(kind, now));
  if (kind === 'minute') return new Date(start.getTime() + 60_000);
  if (kind === 'day') return new Date(start.getTime() + 86_400_000);
  const next = new Date(start.getTime());
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

function secondsUntil(target: Date, now: Date): number {
  return Math.max(1, Math.ceil((target.getTime() - now.getTime()) / 1000));
}

/**
 * Decide whether one more request is allowed, given usage that ALREADY
 * includes this request (the counter is incremented atomically first, then
 * checked). Counting after the fact would let a burst of concurrent requests
 * all read the same pre-increment value and all pass.
 *
 * Windows are checked burst-first: a client hammering us in a loop should be
 * told "slow down for 12 seconds", not "your monthly quota is fine".
 */
export function evaluateLimits(
  usage: WindowUsage,
  limits: PartnerLimits,
  now: Date,
): LimitDecision {
  const checks: { window: LimitWindow; used: number; limit: number }[] = [
    { window: 'minute', used: usage.minute, limit: limits.perMinute },
    { window: 'day', used: usage.day, limit: limits.perDay },
    { window: 'month', used: usage.month, limit: limits.perMonth },
  ];

  const minuteHeaders = {
    limit: limits.perMinute,
    remaining:
      limits.perMinute === 0
        ? Number.MAX_SAFE_INTEGER
        : Math.max(0, limits.perMinute - usage.minute),
    resetAt: windowEnd('minute', now).toISOString(),
  };

  for (const check of checks) {
    if (check.limit === 0) continue;
    if (check.used > check.limit) {
      const reset = windowEnd(check.window, now);
      return {
        allowed: false,
        exceededWindow: check.window,
        retryAfterSeconds: secondsUntil(reset, now),
        headers: {
          limit: check.limit,
          remaining: 0,
          resetAt: reset.toISOString(),
        },
      };
    }
  }

  return {
    allowed: true,
    exceededWindow: null,
    retryAfterSeconds: 0,
    headers: minuteHeaders,
  };
}

/**
 * Tier defaults. Sandbox is deliberately tighter than live on the burst
 * window: a partner load-testing their integration should hit OUR limit early
 * and loudly, not discover it in production.
 */
export const TIER_LIMITS: Record<string, PartnerLimits> = {
  sandbox: { perMinute: 60, perDay: 5_000, perMonth: 50_000 },
  standard: { perMinute: 120, perDay: 50_000, perMonth: 1_000_000 },
  scale: { perMinute: 600, perDay: 500_000, perMonth: 10_000_000 },
  enterprise: { perMinute: 0, perDay: 0, perMonth: 0 },
};

export function limitsFor(
  tier: string,
  environment: 'sandbox' | 'live',
): PartnerLimits {
  if (environment === 'sandbox') return TIER_LIMITS.sandbox;
  return TIER_LIMITS[tier] ?? TIER_LIMITS.standard;
}
