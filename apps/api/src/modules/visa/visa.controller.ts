import {
  BadRequestException,
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { SupabaseClient } from '@supabase/supabase-js';
import { JwtGuard } from '../auth/jwt.guard';
import type { AuthUser } from '../auth/jwt.guard';
import {
  CurrentUser,
  SupabaseUserClient,
} from '../auth/current-user.decorator';
import { AnalyzeRequest } from './visa.dto';
import {
  VisaOrchestrationEngine,
  VisaStageError,
} from './visa-orchestration.service';
import { UserProfileRepository } from '../shared/users/user-profile.repository';

@Controller('visa')
@UseGuards(JwtGuard)
export class VisaController {
  constructor(
    private readonly engine: VisaOrchestrationEngine,
    private readonly users: UserProfileRepository,
  ) {}

  /** Best-effort read of the user's preferred UI language (drives AI response
   *  language). Falls back to null (English) on any error or unset preference. */
  private getUserLanguage(
    db: SupabaseClient,
    userId: string,
  ): Promise<string | null> {
    return this.users.getPreferredLanguage(db, userId);
  }

  /**
   * POST /visa/analyze — runs the research -> evaluation -> copywriter pipeline.
   * Validation: 400. Per-stage AI failure: 502 with the failing stage. Otherwise 500.
   */
  // SEC-3041/6009: this fans out to a 3-stage LLM pipeline on a metered
  // provider. Cap it well below the generic global throttle so a single
  // account cannot amplify AI spend.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('analyze')
  async analyze(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    const parsed = AnalyzeRequest.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }

    const language = await this.getUserLanguage(db, user.id);

    try {
      const { research, evaluation, report } = await this.engine.run({
        ...parsed.data,
        language,
      });
      return { ok: true, research, evaluation, report };
    } catch (err) {
      if (err instanceof VisaStageError) {
        throw new HttpException(
          { ok: false, stage: err.stage, error: err.message },
          HttpStatus.BAD_GATEWAY,
        );
      }
      throw new HttpException(
        { ok: false, error: 'visa analysis failed' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
