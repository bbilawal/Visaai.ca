import {
  Controller,
  Get,
  Param,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { JwtGuard } from '../auth/jwt.guard';
import {
  CurrentUser,
  SupabaseUserClient,
} from '../auth/current-user.decorator';
import { ProgressService } from './progress.service';
import type { AuthUser } from '../auth/jwt.guard';

@UseGuards(JwtGuard)
@Controller('progress')
export class ProgressController {
  constructor(private readonly progress: ProgressService) {}

  @Get(':applicationId')
  async get(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
  ) {
    const result = await this.progress.forApplication(
      db,
      applicationId,
      user.id,
    );
    if (!result) throw new NotFoundException('Application not found');
    return result;
  }
}
