import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ProfileService } from './profile.service';
import { SecurityService } from './security.service';
import { UpdateProfileDto } from './iam.dto';

/**
 * User profile + security self-service (`/me/...`). Authenticated; scoped to the
 * caller's own row (RLS enforces user_profiles ownership; login_history owner-read).
 */
@Controller('me')
@UseGuards(JwtGuard)
export class ProfileController {
  constructor(
    private readonly profile: ProfileService,
    private readonly security: SecurityService,
  ) {}

  @Get('profile')
  get(@CurrentUser() user: AuthUser) {
    return this.profile.get(user.id);
  }

  @Patch('profile')
  update(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const parsed = UpdateProfileDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.profile.update(user.id, parsed.data);
  }

  @Get('login-history')
  loginHistory(@CurrentUser() user: AuthUser, @Query('limit') limit?: string) {
    const n = limit ? Number(limit) : 50;
    return this.security.loginHistory(user.id, Number.isFinite(n) ? n : 50);
  }
}
