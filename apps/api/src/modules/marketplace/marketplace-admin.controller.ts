import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import type { ConsultantProfile } from '@visaai/types';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard, RequireRole } from '../auth/roles.guard';
import {
  MarketplaceAdminService,
  type ReviewableConsultant,
} from './marketplace-admin.service';

/** Reviewer transitions only — `pending_review` belongs to the consultant. */
const SetStatusDto = z.object({
  active_status: z.enum(['active', 'suspended', 'draft']),
});

const ListQueryDto = z.object({
  status: z
    .enum(['draft', 'pending_review', 'active', 'suspended'])
    .default('pending_review'),
});

/**
 * Admin review queue for consultant marketplace profiles.
 *
 * Without this, `/become-a-consultant` submitted into a queue nothing could
 * process: `active` is admin-only, so every self-onboarded consultant would sit
 * at `pending_review` until someone edited the database by hand.
 */
@Controller('admin/marketplace/consultants')
@UseGuards(JwtGuard, RolesGuard)
@RequireRole('admin')
export class MarketplaceAdminController {
  constructor(private readonly admin: MarketplaceAdminService) {}

  @Get()
  list(@Query() query: unknown): Promise<ReviewableConsultant[]> {
    const parsed = ListQueryDto.safeParse(query ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.admin.listByStatus(parsed.data.status);
  }

  @Post(':id/status')
  setStatus(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ConsultantProfile> {
    const parsed = SetStatusDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.admin.setStatus(id, parsed.data.active_status);
  }
}
