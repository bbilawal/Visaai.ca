import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { MatchingService } from './matching.service';
import { CandidatesQueryDto } from './matching.dto';

/**
 * Matching API (M3). Authenticated; the service authorizes per application
 * (staff = any; applicant = own only). Read-only — proposes a ranking, never
 * assigns.
 */
@Controller('matching')
@UseGuards(JwtGuard)
export class MatchingController {
  constructor(private readonly matching: MatchingService) {}

  @Get('candidates')
  candidates(@Query() query: unknown, @CurrentUser() user: AuthUser) {
    const parsed = CandidatesQueryDto.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.matching.rank(
      parsed.data.applicationId,
      { id: user.id, appRole: user.appRole },
      parsed.data.limit,
    );
  }
}
