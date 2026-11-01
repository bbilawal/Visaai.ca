import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { JwtGuard } from '../auth/jwt.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { VoiceSessionService } from './voice-session.service';
import { VOICE_DISCLAIMER_EN, type ConsentKind } from './voice-safety';

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw new BadRequestException(result.error.flatten());
  return result.data;
}

function bearer(authHeader: string | undefined): string {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new BadRequestException('Missing authorization token');
  }
  return authHeader.slice(7);
}

const uuid = z.string().uuid();

const ConsentDto = z.object({
  kind: z.enum([
    'microphone',
    'transcription',
    'transcript_retention',
    'transcript_sharing',
  ]),
  granted: z.boolean(),
});

const StartDto = z.object({
  applicationId: uuid.optional(),
  language: z.string().min(2).max(12).optional(),
});

const AttachDto = z.object({ consultationId: uuid });

/**
 * Voice session lifecycle over REST. Audio itself travels on the `/voice`
 * socket.io namespace (ADR 0001) — this controller handles everything that is
 * request/response: consent, start/pause/resume/end, transcript read and
 * erasure, and escalation attachment.
 *
 * NOT @AllowAnonymous: a guest has no case to discuss and no consent record,
 * and voice is metered per account.
 */
@Controller('voice')
@UseGuards(JwtGuard)
export class VoiceController {
  constructor(private readonly sessions: VoiceSessionService) {}

  /** What the client must show before asking for the microphone. */
  @Get('capabilities')
  capabilities(): {
    languages: string[];
    disclaimer: string;
    requiredConsents: ConsentKind[];
  } {
    return {
      languages: this.sessions.supportedLanguages(),
      disclaimer: VOICE_DISCLAIMER_EN,
      requiredConsents: ['microphone', 'transcription'],
    };
  }

  @Get('consents')
  listConsents(
    @CurrentUser() user: AuthUser,
    @Headers('authorization') auth?: string,
  ) {
    return this.sessions.listConsents(bearer(auth), user);
  }

  @Post('consents')
  async recordConsent(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Headers('authorization') auth?: string,
  ): Promise<{ ok: true }> {
    const dto = parse(ConsentDto, body);
    await this.sessions.recordConsent(
      bearer(auth),
      user,
      dto.kind,
      dto.granted,
    );
    return { ok: true };
  }

  @Post('sessions')
  start(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Headers('authorization') auth?: string,
  ) {
    return this.sessions.start(bearer(auth), user, parse(StartDto, body));
  }

  @Post('sessions/:id/pause')
  pause(@Param('id') id: string, @Headers('authorization') auth?: string) {
    return this.sessions.pause(bearer(auth), parse(uuid, id));
  }

  @Post('sessions/:id/resume')
  resume(@Param('id') id: string, @Headers('authorization') auth?: string) {
    return this.sessions.resume(bearer(auth), parse(uuid, id));
  }

  @Post('sessions/:id/end')
  end(@Param('id') id: string, @Headers('authorization') auth?: string) {
    return this.sessions.end(bearer(auth), parse(uuid, id));
  }

  /** Full text alternative — the accessibility fallback for the whole feature. */
  @Get('sessions/:id/transcript')
  transcript(@Param('id') id: string, @Headers('authorization') auth?: string) {
    return this.sessions.transcript(bearer(auth), parse(uuid, id));
  }

  @Delete('sessions/:id/transcript')
  async deleteTranscript(
    @Param('id') id: string,
    @Headers('authorization') auth?: string,
  ): Promise<{ ok: true }> {
    await this.sessions.deleteTranscript(bearer(auth), parse(uuid, id));
    return { ok: true };
  }

  @Post('sessions/:id/attach-consultation')
  async attach(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('authorization') auth?: string,
  ): Promise<{ ok: true }> {
    const dto = parse(AttachDto, body);
    await this.sessions.attachToConsultation(
      bearer(auth),
      user,
      parse(uuid, id),
      dto.consultationId,
    );
    return { ok: true };
  }
}
