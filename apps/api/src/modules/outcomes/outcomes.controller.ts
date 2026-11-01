import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { JwtGuard } from '../auth/jwt.guard';
import {
  CurrentUser,
  SupabaseUserClient,
} from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/jwt.guard';
import { OutcomesService } from './outcomes.service';
import { ReportOutcomeDto } from './outcomes.dto';

@Controller('outcomes')
@UseGuards(JwtGuard)
export class OutcomesController {
  constructor(private outcomes: OutcomesService) {}

  @Get(':applicationId')
  async get(
    @SupabaseUserClient() db: SupabaseClient,
    @Param('applicationId') applicationId: string,
  ) {
    return this.outcomes.get(db, applicationId);
  }

  @Post(':applicationId')
  async report(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Body() body: unknown,
  ) {
    // API-001: `@Body()` typed as an interface is erased at runtime, so this
    // route previously forwarded anything to the database and let the CHECK
    // constraint reject it as a 500. Validate first and answer 400.
    const parsed = ReportOutcomeDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.outcomes.report(db, applicationId, user.id, parsed.data);
  }
}
