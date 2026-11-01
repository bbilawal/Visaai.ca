import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import type { ConsultantReviewItems, ReviewGeneratedItem } from '@visaai/types';
import { JwtGuard, type AuthUser } from '../auth/jwt.guard';
import { ApplicationAccessGuard } from '../auth/application-access.guard';
import { RequireRole, RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { parseBody } from '../../common/zod-body';
import { ReviewItemsService } from './review-items.service';

const DecideDto = z.object({
  itemKind: z.enum(['document', 'generated']),
  itemId: z.string().uuid(),
  decision: z.enum([
    'approved',
    'needs_reupload',
    'changes_requested',
    'rejected',
  ]),
  note: z.string().max(2000).optional(),
});
const EditDto = z.object({
  contentMd: z.string().max(50_000),
  note: z.string().max(500).optional(),
});

// Ids are UUID-validated at the edge: a malformed id would otherwise reach
// Postgres, fail the uuid cast, and surface as a 500.
function bearer(auth?: string): string {
  return (auth ?? '').replace(/^Bearer\s+/i, '');
}

/**
 * Consultant review of uploaded documents and generated items.
 * Guards: logged in (JwtGuard), related to the application
 * (ApplicationAccessGuard), consultant role (RolesGuard; admin passes) — and
 * the service requires the ACTIVE assignment, because ApplicationAccessGuard
 * also admits the applicant and RolesGuard alone admits any consultant.
 */
@UseGuards(JwtGuard, ApplicationAccessGuard, RolesGuard)
@RequireRole('consultant')
@Controller('applications/:applicationId/review-items')
export class ReviewItemsController {
  constructor(private readonly svc: ReviewItemsService) {}

  @Get()
  list(
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ConsultantReviewItems> {
    return this.svc.list(applicationId, user);
  }

  @Get('documents/:documentId/url')
  open(
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<{ url: string; expiresIn: number }> {
    return this.svc.openDocument(applicationId, documentId, user);
  }

  @Post('decisions')
  async decide(
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() rawBody: unknown,
    @CurrentUser() user: AuthUser,
    @Headers('authorization') auth?: string,
  ) {
    const body = parseBody(DecideDto, rawBody);
    return this.svc.decide(applicationId, user, body, bearer(auth));
  }

  @Put('generated/:generatedId')
  async editGenerated(
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('generatedId', ParseUUIDPipe) generatedId: string,
    @Body() rawBody: unknown,
    @CurrentUser() user: AuthUser,
  ): Promise<ReviewGeneratedItem> {
    const body = parseBody(EditDto, rawBody);
    return this.svc.editGenerated(
      applicationId,
      user,
      generatedId,
      body.contentMd,
      body.note,
    );
  }
}
