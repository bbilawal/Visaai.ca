import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SecurityService } from './security.service';
import { MfaEventDto } from './iam.dto';

/**
 * MFA status + audit (Phase C). Enrollment/verify/unenroll run client-side via
 * Supabase native TOTP (secrets live in Supabase, never here). This surface only
 * (a) reports the caller's MFA state from the verified token/user, and (b) records
 * the enable/disable security events the client reports after a Supabase MFA op.
 */
@Controller('me/mfa')
@UseGuards(JwtGuard)
export class MfaController {
  constructor(private readonly security: SecurityService) {}

  /** Current MFA state: whether a verified factor exists + this session's AAL. */
  @Get()
  status(@CurrentUser() user: AuthUser): {
    enabled: boolean;
    aal: string | null;
    stepUpRequired: boolean;
  } {
    const enabled = user.mfaEnabled ?? false;
    const aal = user.aal ?? null;
    return { enabled, aal, stepUpRequired: enabled && aal !== 'aal2' };
  }

  /** Record an enable/disable event (the Supabase MFA op already happened). */
  @Post('event')
  async event(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{ recorded: true }> {
    const parsed = MfaEventDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    await this.security.recordEvent({
      userId: user.id,
      actorId: user.id,
      eventType: parsed.data.event,
      ip,
      userAgent,
    });
    return { recorded: true };
  }
}
