import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtGuard } from '../auth/jwt.guard';
import { ApplicationAccessGuard } from '../auth/application-access.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { MessagingAiService } from './messaging-ai.service';

// SEC-3041: the instruction is free text interpolated into an LLM prompt.
// Bound its length so it can't be used to inflate token spend or as an
// oversized injection payload.
const MAX_INSTRUCTION_LEN = 2000;

function bearer(authHeader: string | undefined): string {
  if (!authHeader?.startsWith('Bearer '))
    throw new BadRequestException('Missing authorization token');
  return authHeader.slice(7);
}

@Controller('messaging')
@UseGuards(JwtGuard)
export class MessagingAiController {
  constructor(private readonly svc: MessagingAiService) {}

  /** Staff-only: draft a suggested reply (the service enforces isStaff → 403 for users). */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':applicationId/ai-draft')
  @UseGuards(ApplicationAccessGuard)
  draft(
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Body() body: { instruction?: string },
    @Headers('authorization') auth?: string,
  ): Promise<{ draft: string }> {
    const raw = body?.instruction?.trim();
    if (raw && raw.length > MAX_INSTRUCTION_LEN) {
      throw new BadRequestException(
        `instruction exceeds ${MAX_INSTRUCTION_LEN} characters`,
      );
    }
    const instruction = raw || undefined;
    return this.svc.draftReply(bearer(auth), user, applicationId, instruction);
  }
}
