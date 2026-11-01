import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { SupabaseClient } from '@supabase/supabase-js';
import { JwtGuard } from '../auth/jwt.guard';
import { PlanGuard, RequirePlan } from '../auth/plan.guard';
import {
  CurrentUser,
  SupabaseUserClient,
} from '../auth/current-user.decorator';
import { VriService } from './vri.service';
import type { AuthUser } from '../auth/jwt.guard';

@Controller('vri')
@UseGuards(JwtGuard, PlanGuard)
export class VriController {
  constructor(private vri: VriService) {}

  // SEC-3041: runs the VRI scoring + visa-suggestion LLM pipeline — cap it.
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post(':applicationId/calculate')
  @RequirePlan('self_service')
  async calculate(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
  ) {
    return this.vri.calculate(db, applicationId, user.id);
  }

  @Get(':applicationId')
  async getLatest(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
  ) {
    return this.vri.getLatest(db, applicationId, user.id);
  }

  @Post(':applicationId/apply-suggestion/:suggestionId')
  @RequirePlan('copilot')
  async applySuggestion(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Param('suggestionId') suggestionId: string,
  ) {
    return this.vri.applySuggestionToChecklist(
      db,
      applicationId,
      suggestionId,
      user.id,
    );
  }
}
