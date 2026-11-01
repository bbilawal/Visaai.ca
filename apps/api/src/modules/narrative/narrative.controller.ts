import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { SupabaseClient } from '@supabase/supabase-js';
import { JwtGuard } from '../auth/jwt.guard';
import { PlanGuard, RequirePlan } from '../auth/plan.guard';
import {
  CurrentUser,
  SupabaseUserClient,
} from '../auth/current-user.decorator';
import { NarrativeService } from './narrative.service';
import type { AuthUser } from '../auth/jwt.guard';
import { z } from 'zod';
import { parseBody } from '../../common/zod-body';

const GenerateDto = z.object({
  docType: z.enum(['loe', 'itinerary', 'cover_letter']),
});
const ApproveDto = z.object({
  editedContent: z.string().max(100_000).optional(),
});
const SaveDto = z.object({
  content: z.string().max(100_000),
});

@Controller('narrative')
@UseGuards(JwtGuard, PlanGuard)
export class NarrativeController {
  constructor(private narrative: NarrativeService) {}

  // SEC-3041: LLM-backed generation on a metered provider — cap per account.
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post(':applicationId/generate')
  @RequirePlan('copilot')
  async generate(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Body() rawBody: unknown,
  ) {
    const body = parseBody(GenerateDto, rawBody);
    return this.narrative.generate(db, applicationId, user.id, body.docType);
  }

  @Post('document/:documentId/approve')
  async approve(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('documentId') documentId: string,
    @Body() rawBody: unknown,
  ) {
    const body = parseBody(ApproveDto, rawBody);
    return this.narrative.approve(db, documentId, user.id, body.editedContent);
  }

  /** Save an edit as a draft — approval stays a separate, explicit step. */
  @Post('document/:documentId/save')
  async save(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('documentId') documentId: string,
    @Body() rawBody: unknown,
  ) {
    const body = parseBody(SaveDto, rawBody);
    return this.narrative.saveDraft(db, documentId, user.id, body.content);
  }

  @Get(':applicationId')
  async list(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
  ) {
    return this.narrative.list(db, applicationId, user.id);
  }
}
