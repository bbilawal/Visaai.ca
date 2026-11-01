import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import {
  JwtGuard,
  AllowAnonymous,
  AllowUnauthenticated,
  type AuthUser,
} from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AnalyticsIngestService } from './ingest/analytics-ingest.service';
import { parseClientEvent } from './events/catalog';
import type { CollectDto } from './dto/collect.dto';
import type { Env } from '../../config/configuration';

@Controller('analytics')
@UseGuards(JwtGuard)
export class AnalyticsController {
  constructor(
    private readonly ingest: AnalyticsIngestService,
    private readonly config: ConfigService<Env>,
  ) {}

  /**
   * ANALYTICS-001. This endpoint is reached by `navigator.sendBeacon`, which
   * CANNOT set an Authorization header, so it must accept a request with no
   * credential at all — @AllowAnonymous only ever admitted a guest holding a
   * token, and every top-of-funnel event (landing, pricing, signup, login) was
   * therefore rejected with a 401 and silently lost.
   *
   * Write-only and safe to expose: it returns nothing but a count, never reads
   * back, and attributes events only to a verified non-anonymous session.
   * Unauthenticated volume is bounded by the throttle below and by
   * ANALYTICS_COLLECT_MAX_EVENTS per request.
   */
  @Post('collect')
  @AllowAnonymous()
  @AllowUnauthenticated()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(202)
  async collect(
    @Body() body: CollectDto,
    @CurrentUser() user: AuthUser | null,
  ): Promise<{ accepted: number }> {
    const max =
      this.config.get('ANALYTICS_COLLECT_MAX_EVENTS', { infer: true }) ?? 50;
    const raw = Array.isArray(body?.events) ? body.events.slice(0, max) : [];
    const userId = user && !user.isAnonymous ? user.id : null;
    const events = raw
      .map((r) => parseClientEvent(r))
      .filter((e): e is NonNullable<typeof e> => e !== null)
      .map((e) => ({ ...e, user_id: userId }));
    if (events.length) await this.ingest.ingest(events);
    return { accepted: events.length };
  }

  @Post('identify')
  @AllowAnonymous()
  @AllowUnauthenticated()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(202)
  async identify(
    @Body() body: CollectDto,
    @CurrentUser() user: AuthUser | null,
  ): Promise<{ accepted: number }> {
    return this.collect(body, user);
  }
}
