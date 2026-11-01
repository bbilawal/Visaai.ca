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
import type { Consultation } from '@visaai/types';
import type { z } from 'zod';
import { JwtGuard } from '../auth/jwt.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ConsultationsService } from './consultations.service';
import {
  CreateBookingDto,
  RescheduleBookingDto,
  SlotsQueryDto,
} from './consultations.dto';

/** Parse an untrusted payload against a zod schema or fail with a 400. */
function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw new BadRequestException(result.error.flatten());
  return result.data;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Path params reach `.eq()` directly; a non-UUID would surface as a 500. */
function uuidParam(value: string, name: string): string {
  if (!UUID_RE.test(value))
    throw new BadRequestException(`${name} must be a UUID`);
  return value;
}

function bearer(authHeader: string | undefined): string {
  if (!authHeader?.startsWith('Bearer '))
    throw new BadRequestException('Missing authorization token');
  return authHeader.slice(7);
}

/**
 * Applicant-facing consultation scheduling.
 *
 * The `consultations` table shipped with the marketplace migration
 * (20260626000000) but had no HTTP surface, so nothing could book one. These
 * routes close that gap for web and mobile alike.
 *
 * Not @AllowAnonymous: a guest (anonymous Supabase session) must not hold a
 * consultant's calendar slot, so booking requires a real account.
 */
@Controller('consultations')
@UseGuards(JwtGuard)
export class ConsultationsController {
  constructor(private readonly consultations: ConsultationsService) {}

  /** GET /consultations/consultants/:consultantId/slots?from&to&slotMinutes */
  @Get('consultants/:consultantId/slots')
  slots(
    @Param('consultantId') consultantId: string,
    @Query() query: unknown,
    @Headers('authorization') auth?: string,
  ): Promise<{ timezone: string; slots: { start: string; end: string }[] }> {
    return this.consultations.listSlots(
      bearer(auth),
      uuidParam(consultantId, 'consultantId'),
      parse(SlotsQueryDto, query),
    );
  }

  @Post()
  book(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Headers('authorization') auth?: string,
  ): Promise<Consultation> {
    return this.consultations.book(
      bearer(auth),
      user,
      parse(CreateBookingDto, body),
    );
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Headers('authorization') auth?: string,
  ): Promise<Consultation[]> {
    return this.consultations.list(bearer(auth), user);
  }

  @Post(':id/cancel')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Headers('authorization') auth?: string,
  ): Promise<Consultation> {
    return this.consultations.cancel(bearer(auth), user, uuidParam(id, 'id'));
  }

  @Post(':id/reschedule')
  reschedule(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('authorization') auth?: string,
  ): Promise<Consultation> {
    return this.consultations.reschedule(
      bearer(auth),
      user,
      uuidParam(id, 'id'),
      parse(RescheduleBookingDto, body),
    );
  }
}
