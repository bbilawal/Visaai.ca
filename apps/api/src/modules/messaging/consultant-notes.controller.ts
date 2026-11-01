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
import type { ConsultantNote } from '@visaai/types';
import { JwtGuard } from '../auth/jwt.guard';
import { ApplicationAccessGuard } from '../auth/application-access.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ConsultantNotesService } from './consultant-notes.service';

function bearer(authHeader: string | undefined): string {
  if (!authHeader?.startsWith('Bearer '))
    throw new BadRequestException('Missing authorization token');
  return authHeader.slice(7);
}

@Controller('messaging')
@UseGuards(JwtGuard)
export class ConsultantNotesController {
  constructor(private readonly svc: ConsultantNotesService) {}

  @Get(':applicationId/notes')
  @UseGuards(ApplicationAccessGuard)
  list(
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Headers('authorization') auth?: string,
  ): Promise<ConsultantNote[]> {
    return this.svc.list(bearer(auth), user, applicationId);
  }

  @Post(':applicationId/notes')
  @UseGuards(ApplicationAccessGuard)
  create(
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Body() body: { body?: string },
    @Headers('authorization') auth?: string,
  ): Promise<ConsultantNote> {
    const text = body?.body?.trim();
    if (!text) throw new BadRequestException('Note body is required');
    return this.svc.create(bearer(auth), user, applicationId, text);
  }

  @Patch('notes/:noteId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('noteId') noteId: string,
    @Body() body: { body?: string },
    @Headers('authorization') auth?: string,
  ): Promise<ConsultantNote> {
    const text = body?.body?.trim();
    if (!text) throw new BadRequestException('Note body is required');
    return this.svc.update(bearer(auth), user, noteId, text);
  }
}
