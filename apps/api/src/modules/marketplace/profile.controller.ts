import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import type {
  ConsultantAvailability,
  ConsultantProfile,
  ConsultantSkills,
} from '@visaai/types';
import { JwtGuard } from '../auth/jwt.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ProfileService } from './profile.service';
import {
  CreateProfileDto,
  UpdateProfileDto,
  UpsertAvailabilityDto,
  UpsertSkillsDto,
  type ConsultantProfileBundle,
} from './marketplace.dto';

function bearer(authHeader: string | undefined): string {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new BadRequestException('Missing authorization token');
  }
  return authHeader.slice(7);
}

/**
 * Consultant self-serve marketplace profile (MKT-1, MKT-2). JwtGuard only — no
 * RolesGuard: a new consultant onboards by creating their OWN profile before any
 * assignment exists (so appRole may still be 'user'). The security boundary is
 * RLS owner-write (auth.uid() == user_id) via the request-scoped client.
 */
@Controller('marketplace/profile')
@UseGuards(JwtGuard)
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Get()
  getMine(
    @CurrentUser() user: AuthUser,
    @Headers('authorization') auth?: string,
  ): Promise<ConsultantProfileBundle> {
    return this.profiles.getMyProfile(bearer(auth), user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Headers('authorization') auth?: string,
  ): Promise<ConsultantProfile> {
    const parsed = CreateProfileDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.profiles.createProfile(bearer(auth), user.id, parsed.data);
  }

  @Patch()
  update(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Headers('authorization') auth?: string,
  ): Promise<ConsultantProfile> {
    const parsed = UpdateProfileDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.profiles.updateProfile(bearer(auth), user.id, parsed.data);
  }

  @Put('skills')
  skills(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Headers('authorization') auth?: string,
  ): Promise<ConsultantSkills> {
    const parsed = UpsertSkillsDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.profiles.upsertSkills(bearer(auth), user.id, parsed.data);
  }

  @Put('availability')
  availability(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Headers('authorization') auth?: string,
  ): Promise<ConsultantAvailability> {
    const parsed = UpsertAvailabilityDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.profiles.upsertAvailability(bearer(auth), user.id, parsed.data);
  }

  /** Refresh countries_supported from the consultant_countries source of truth. */
  @Post('sync-countries')
  syncCountries(
    @CurrentUser() user: AuthUser,
    @Headers('authorization') auth?: string,
  ): Promise<ConsultantSkills> {
    return this.profiles.syncCountries(bearer(auth), user.id);
  }
}
