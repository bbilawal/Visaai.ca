import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { JwtGuard } from '../auth/jwt.guard';
import { PlanGuard } from '../auth/plan.guard';
import {
  CurrentUser,
  SupabaseUserClient,
} from '../auth/current-user.decorator';
import { AutomationService } from './automation.service';
import type { AuthUser } from '../auth/jwt.guard';
import { z } from 'zod';
import { parseBody } from '../../common/zod-body';

const StartAutomationDto = z.object({
  portalUrl: z.string().url().optional(),
});

@Controller('automation')
@UseGuards(JwtGuard, PlanGuard)
export class AutomationController {
  constructor(private automation: AutomationService) {}

  // Gated by the one-time form fee inside the service (HTTP 402 if unpaid).
  @Post(':applicationId/session')
  async createSession(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Body() rawBody: unknown = {},
  ) {
    const body = parseBody(StartAutomationDto, rawBody ?? {});
    return this.automation.createSession(
      db,
      applicationId,
      user.id,
      body.portalUrl,
    );
  }

  @Get('session/:sessionId')
  async getSession(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('sessionId') sessionId: string,
  ) {
    return this.automation.getSession(db, sessionId, user.id);
  }
}
