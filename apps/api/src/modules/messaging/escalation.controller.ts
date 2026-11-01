import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { EscalationRecord, EscalationType } from '@visaai/types';
import { JwtGuard } from '../auth/jwt.guard';
import { ApplicationAccessGuard } from '../auth/application-access.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { EscalationService } from './escalation.service';

function bearer(authHeader: string | undefined): string {
  if (!authHeader?.startsWith('Bearer '))
    throw new BadRequestException('Missing authorization token');
  return authHeader.slice(7);
}

const TYPES: ReadonlySet<string> = new Set([
  'complex_case',
  'legal_review',
  'supervisor_review',
  'specialist_review',
]);

@Controller('messaging')
@UseGuards(JwtGuard)
export class EscalationController {
  constructor(private readonly svc: EscalationService) {}

  @Get(':applicationId/escalations')
  @UseGuards(ApplicationAccessGuard)
  list(
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Headers('authorization') auth?: string,
  ): Promise<EscalationRecord[]> {
    return this.svc.list(bearer(auth), user, applicationId);
  }

  @Post(':applicationId/escalations')
  @UseGuards(ApplicationAccessGuard)
  escalate(
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Body() body: { type?: string; reason?: string },
    @Headers('authorization') auth?: string,
  ): Promise<EscalationRecord> {
    if (!body?.type || !TYPES.has(body.type))
      throw new BadRequestException(
        `Invalid escalation type: ${body?.type ?? ''}`,
      );
    if (!body?.reason?.trim())
      throw new BadRequestException('Escalation reason is required');
    return this.svc.escalate(bearer(auth), user, applicationId, {
      type: body.type as EscalationType,
      reason: body.reason.trim(),
    });
  }

  @Patch('escalations/:escalationId/resolve')
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('escalationId') escalationId: string,
    @Headers('authorization') auth?: string,
  ): Promise<EscalationRecord> {
    return this.svc.resolve(bearer(auth), user, escalationId);
  }
}
