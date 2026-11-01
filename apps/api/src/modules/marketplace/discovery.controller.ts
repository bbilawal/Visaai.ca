import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { ConsultantCard, ConsultantReview } from '@visaai/types';
import { AllowAnonymous, JwtGuard } from '../auth/jwt.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { DiscoveryService } from './discovery.service';
import {
  CreateReviewDto,
  DiscoveryQueryDto,
  type ConsultantDetail,
} from './marketplace.dto';

function bearer(authHeader: string | undefined): string {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new BadRequestException('Missing authorization token');
  }
  return authHeader.slice(7);
}

/**
 * Public marketplace discovery + reviews (MKT-3, MKT-4).
 *
 * Browse/detail/list-reviews are @AllowAnonymous so a guest (anonymous Supabase
 * identity) can browse; the request-scoped client still applies the public-read
 * RLS, so only active profiles surface regardless of caller. Posting a review
 * requires a real account (no @AllowAnonymous) — RLS ties the row to the author.
 */
@Controller('marketplace/consultants')
@UseGuards(JwtGuard)
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Get()
  @AllowAnonymous()
  list(
    @Query() query: unknown,
    @Headers('authorization') auth?: string,
  ): Promise<ConsultantCard[]> {
    const parsed = DiscoveryQueryDto.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.discovery.listConsultants(bearer(auth), {
      visaType: parsed.data.visa_type,
      country: parsed.data.country,
      language: parsed.data.language,
    });
  }

  @Get(':id')
  @AllowAnonymous()
  detail(
    @Param('id') id: string,
    @Headers('authorization') auth?: string,
  ): Promise<ConsultantDetail> {
    return this.discovery.getConsultant(bearer(auth), id);
  }

  @Post(':id/reviews')
  createReview(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Headers('authorization') auth?: string,
  ): Promise<ConsultantReview> {
    const parsed = CreateReviewDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.discovery.createReview(bearer(auth), id, user.id, parsed.data);
  }

  @Get(':id/reviews')
  @AllowAnonymous()
  listReviews(
    @Param('id') id: string,
    @Headers('authorization') auth?: string,
  ): Promise<ConsultantReview[]> {
    return this.discovery.listReviews(bearer(auth), id);
  }
}
