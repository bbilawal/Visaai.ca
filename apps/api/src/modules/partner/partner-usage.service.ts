import { Inject, Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PartnerPrincipal, PartnerUsageSnapshot } from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import {
  evaluateLimits,
  limitsFor,
  windowEnd,
  windowStart,
  type LimitDecision,
} from './partner-rate-limit';
import { PARTNER_REPOSITORY } from './partner.tokens';
import type { IPartnerRepository, RequestLogEntry } from './partner.repository';

/**
 * Rate limiting, quotas and the request log.
 *
 * The counter is incremented FIRST and evaluated second. Reading then writing
 * would let a burst of concurrent requests all observe the same pre-increment
 * value and all pass — which is precisely the traffic pattern a rate limit
 * exists to stop.
 */
@Injectable()
export class PartnerUsageService {
  constructor(
    private readonly supabase: SupabaseService,
    @Inject(PARTNER_REPOSITORY) private readonly repo: IPartnerRepository,
  ) {}

  private get db(): SupabaseClient {
    return this.supabase.admin;
  }

  /** Count one request and decide whether it is allowed. */
  async consume(
    principal: PartnerPrincipal,
    tier = 'standard',
    now: Date = new Date(),
  ): Promise<LimitDecision> {
    const limits = limitsFor(tier, principal.environment);

    const [minute, day, month] = await Promise.all([
      this.repo.incrementUsage(
        this.db,
        principal.applicationId,
        'minute',
        windowStart('minute', now),
      ),
      this.repo.incrementUsage(
        this.db,
        principal.applicationId,
        'day',
        windowStart('day', now),
      ),
      this.repo.incrementUsage(
        this.db,
        principal.applicationId,
        'month',
        windowStart('month', now),
      ),
    ]);

    return evaluateLimits({ minute, day, month }, limits, now);
  }

  /** Current usage without consuming any. Backs `GET /v1/usage`. */
  async snapshot(
    principal: PartnerPrincipal,
    tier = 'standard',
    now: Date = new Date(),
  ): Promise<PartnerUsageSnapshot> {
    const limits = limitsFor(tier, principal.environment);
    const counts = await this.repo.readUsage(this.db, principal.applicationId, [
      { kind: 'minute', start: windowStart('minute', now) },
      { kind: 'day', start: windowStart('day', now) },
      { kind: 'month', start: windowStart('month', now) },
    ]);

    const remaining = (limit: number, used: number): number =>
      limit === 0 ? Number.MAX_SAFE_INTEGER : Math.max(0, limit - used);

    return {
      environment: principal.environment,
      rate_limit: {
        limit: limits.perMinute,
        remaining: remaining(limits.perMinute, counts.minute),
        reset_at: windowEnd('minute', now).toISOString(),
      },
      quota_day: {
        limit: limits.perDay,
        used: counts.day,
        remaining: remaining(limits.perDay, counts.day),
        reset_at: windowEnd('day', now).toISOString(),
      },
      quota_month: {
        limit: limits.perMonth,
        used: counts.month,
        remaining: remaining(limits.perMonth, counts.month),
        reset_at: windowEnd('month', now).toISOString(),
      },
    };
  }

  /**
   * Append to the request log. The caller passes a ROUTE TEMPLATE, never the
   * resolved path — see the migration comment on partner_api_requests. Errors
   * are swallowed: telemetry must not turn a 200 into a 500.
   */
  async log(entry: RequestLogEntry): Promise<void> {
    try {
      await this.repo.logRequest(this.db, entry);
    } catch {
      // Intentionally ignored.
    }
  }
}
