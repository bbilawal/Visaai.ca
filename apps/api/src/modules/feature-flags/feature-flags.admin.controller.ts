import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { JwtGuard } from '../auth/jwt.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PermissionsGuard, RequirePermission } from '../iam/permissions.guard';
import { FeatureFlagsAdminService } from './feature-flags.admin.service';
import { FeatureFlagsService } from './feature-flags.service';

const uuid = z.string().uuid();

const PatchDto = z.object({
  enabled: z.boolean().optional(),
  rollout_percentage: z.number().int().min(0).max(100).optional(),
  allowed_roles: z.array(z.enum(['admin', 'consultant', 'user'])).optional(),
  // Cohort slugs are matched against beta_cohorts. A slug with no cohort row
  // matches nobody, so a typo fails closed rather than opening the flag up.
  allowed_cohorts: z.array(z.string().min(2).max(50)).optional(),
  allowed_user_ids: z.array(uuid).optional(),
  environments: z
    .array(z.enum(['development', 'staging', 'production']))
    .optional(),
  description: z.string().max(500).optional(),
  reason: z.string().max(500).optional(),
});

const KillDto = z.object({
  // Not optional. A kill switch without a recorded reason is an unexplained
  // outage in the next morning's review.
  reason: z.string().min(3).max(500),
});

/**
 * Flag administration. `platform.admin` only.
 *
 *   GET   /admin/feature-flags             registry ∪ stored state
 *   GET   /admin/feature-flags/history     audit trail (optionally per flag)
 *   GET   /admin/feature-flags/:key/eval   evaluate for a user, with the reason
 *   PATCH /admin/feature-flags/:key        update state
 *   POST  /admin/feature-flags/:key/kill   disable now, reason required
 *
 * The `/eval` endpoint is the debugging affordance that makes the rest usable:
 * "why does this user not see the feature" is otherwise unanswerable without
 * reproducing the bucketing by hand.
 */
@Controller('admin/feature-flags')
@UseGuards(JwtGuard, PermissionsGuard)
@RequirePermission('platform.admin')
export class FeatureFlagsAdminController {
  constructor(
    private readonly admin: FeatureFlagsAdminService,
    private readonly flags: FeatureFlagsService,
  ) {}

  @Get()
  list() {
    return this.admin.list();
  }

  @Get('history')
  history(@Query('key') key?: string, @Query('limit') limit?: string) {
    const n = limit ? Number(limit) : 100;
    return this.admin.history(key, Number.isFinite(n) ? n : 100);
  }

  @Get(':key/eval')
  async evaluate(@Param('key') key: string, @Query('userId') userId?: string) {
    if (userId && !uuid.safeParse(userId).success) {
      throw new BadRequestException('userId must be a uuid');
    }
    const subject = userId
      ? { userId, cohorts: await this.flags.cohortsFor(userId) }
      : {};
    return this.flags.evaluate(key, subject);
  }

  @Patch(':key')
  update(
    @Param('key') key: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = PatchDto.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => i.message).join('; '),
      );
    }
    const { reason, ...patch } = parsed.data;
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('No changes supplied.');
    }
    return this.admin.set(
      key,
      patch,
      { id: user.id, email: user.email },
      reason,
    );
  }

  @Post(':key/kill')
  kill(
    @Param('key') key: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = KillDto.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        'A reason (3–500 chars) is required to kill a flag.',
      );
    }
    return this.admin.kill(
      key,
      { id: user.id, email: user.email },
      parsed.data.reason,
    );
  }
}
