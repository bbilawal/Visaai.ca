import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
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
import { PrivacyService } from './privacy.service';

const DeleteBodyDto = z.object({
  // Explicit confirmation guards an irreversible action against accidental calls.
  confirmation: z.literal('DELETE'),
});

/**
 * GDPR / PIPEDA data-subject endpoints for the authenticated user.
 *   GET  /me/privacy/export  → portability (Art. 20) — their own data as JSON
 *   POST /me/privacy/delete  → erasure (Art. 17) — irreversible; requires
 *                              body {"confirmation":"DELETE"}
 */
@Controller('me/privacy')
@UseGuards(JwtGuard)
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get('export')
  exportData(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
  ) {
    return this.privacy.exportData(db, user.id, user.email);
  }

  @Post('delete')
  deleteAccount(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const parsed = DeleteBodyDto.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        'Account deletion is irreversible and requires body {"confirmation":"DELETE"}',
      );
    }
    return this.privacy.deleteAccount(user.id, user.email);
  }
}
