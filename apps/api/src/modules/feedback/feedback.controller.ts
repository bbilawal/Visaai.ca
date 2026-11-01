import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { JwtGuard } from '../auth/jwt.guard';
import type { AuthUser } from '../auth/jwt.guard';
import {
  CurrentUser,
  SupabaseUserClient,
} from '../auth/current-user.decorator';
import { PermissionsGuard, RequirePermission } from '../iam/permissions.guard';
import { FeedbackService } from './feedback.service';

const KINDS = [
  'bug',
  'feature_request',
  'satisfaction',
  'ai_response',
  'consultant',
  'other',
] as const;
const SURFACES = ['web', 'ios', 'android', 'extension'] as const;
const STATUSES = [
  'new',
  'triaged',
  'in_progress',
  'resolved',
  'wont_fix',
  'duplicate',
] as const;

const SubmitDto = z.object({
  kind: z.enum(KINDS),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  // Capped here as well as in the service and the column. The client-facing
  // limit is what produces a useful validation error instead of a truncation
  // the user never learns about.
  message: z.string().max(2000).optional(),
  surface: z.enum(SURFACES),
  appVersion: z.string().max(64).optional(),
  applicationId: z.string().uuid().nullable().optional(),
  diagnosticsConsent: z.boolean().optional(),
  screenshotPath: z.string().max(512).nullable().optional(),
  // Passed through the service's allowlist; unrecognised keys are dropped.
  device: z.record(z.string(), z.unknown()).optional(),
});

const TriageDto = z.object({
  status: z.enum(STATUSES).optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  ownerId: z.string().uuid().nullable().optional(),
  resolution: z.string().max(2000).optional(),
});

/**
 * Beta feedback for the authenticated user.
 *
 *   POST /feedback      file a report / rating
 *   GET  /feedback/mine the caller's own reports and their status
 *
 * Both run on the RLS-scoped client, so the policy is the boundary. There is
 * deliberately no update endpoint for the author: an editable bug report
 * invalidates the copy a reviewer is working from.
 *
 * NOT `@AllowAnonymous`. Guests exist in this product, but beta feedback is
 * attributable by design — support has to be able to reply, and an anonymous
 * write path into a support queue is a spam target with no rate-limiting story
 * beyond the global throttler.
 */
@Controller('feedback')
@UseGuards(JwtGuard)
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post()
  submit(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Req() req: { headers: Record<string, string | undefined> },
  ) {
    const parsed = SubmitDto.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      );
    }

    // Server-derived context. Trustworthy in triage precisely because the
    // client cannot set it.
    const context = {
      route: req.headers['x-visaai-route'],
      referer: req.headers.referer,
      user_agent: req.headers['user-agent'],
    };

    return this.feedback.submit(db, user.id, parsed.data, context);
  }

  @Get('mine')
  mine(
    @SupabaseUserClient() db: SupabaseClient,
    @Query('limit') limit?: string,
  ) {
    const n = limit ? Number(limit) : 50;
    return this.feedback.listMine(db, Number.isFinite(n) ? n : 50);
  }
}

/**
 * Triage surface for support and engineering. `support.access` — deliberately
 * NOT `platform.admin`, so a support agent can work the queue without holding
 * full platform administration.
 */
@Controller('admin/feedback')
@UseGuards(JwtGuard, PermissionsGuard)
@RequirePermission('support.access')
export class FeedbackAdminController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('kind') kind?: string,
    @Query('surface') surface?: string,
    @Query('limit') limit?: string,
  ) {
    const n = limit ? Number(limit) : 100;
    return this.feedback.listAll({
      status: parseEnum(status, STATUSES),
      kind: parseEnum(kind, KINDS),
      surface: parseEnum(surface, SURFACES),
      limit: Number.isFinite(n) ? n : 100,
    });
  }

  @Get('summary')
  summary(@Query('days') days?: string) {
    const n = days ? Number(days) : 7;
    const window = Number.isFinite(n)
      ? Math.max(1, Math.min(90, Math.trunc(n)))
      : 7;
    const since = new Date(Date.now() - window * 86_400_000).toISOString();
    return this.feedback.summary(since);
  }

  @Patch(':id')
  triage(@Param('id') id: string, @Body() body: unknown) {
    if (!z.string().uuid().safeParse(id).success) {
      throw new BadRequestException('id must be a uuid');
    }
    const parsed = TriageDto.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => i.message).join('; '),
      );
    }
    return this.feedback.triage(id, parsed.data);
  }
}

/** Narrow a query-string value to a known enum member, or undefined. */
function parseEnum<T extends readonly string[]>(
  value: string | undefined,
  allowed: T,
): T[number] | undefined {
  return value && (allowed as readonly string[]).includes(value)
    ? value
    : undefined;
}
