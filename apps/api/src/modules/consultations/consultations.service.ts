import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Consultation } from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import {
  CONSULTATIONS_REPOSITORY,
  type IConsultationsRepository,
} from './consultations.repository';
import { computeSlots, isBookable, type Slot } from './slots';
import type {
  CreateBookingDto,
  RescheduleBookingDto,
} from './consultations.dto';

export interface BookingCaller {
  id: string;
}

/** Widest window a client may ask for in one slot query. */
const MAX_RANGE_DAYS = 62;
const DAY_MS = 86_400_000;
/** Applicants may not cancel inside this window; they must message instead. */
const CANCEL_CUTOFF_MS = 2 * 3600_000;

/**
 * Consultation scheduling for applicants.
 *
 * Authorization is RLS: every read and write of the caller's own data goes
 * through `SupabaseService.forUser`, and `consultations` policies (participants
 * read; applicant inserts; participants update) are the isolation boundary. The
 * service adds only the rules RLS cannot express — availability windows, lead
 * time, and double-booking.
 *
 * ONE deliberate exception: `listBusyForConsultant` reads with the service-role
 * client, because a calendar's busy windows are by definition other people's
 * rows and RLS correctly hides them. It returns timestamps only. See the method
 * comment for why the scoped client produced a silently-wrong calendar.
 */
@Injectable()
export class ConsultationsService {
  private readonly log = new Logger(ConsultationsService.name);

  constructor(
    @Inject(CONSULTATIONS_REPOSITORY)
    private readonly repo: IConsultationsRepository,
    private readonly supabase: SupabaseService,
  ) {}

  /**
   * Busy windows for a consultant, read with the SERVICE-ROLE client.
   *
   * This is the one deliberate RLS bypass in this service, and it is required
   * for correctness: `consultations_participant_read` only exposes rows where
   * the caller is the applicant or the consultant, so an applicant querying
   * with their own scoped client sees NONE of anyone else's bookings. Every
   * availability check silently believed the calendar was empty, offered taken
   * slots as free, and let the database exclusion constraint reject the booking
   * with a misleading "someone just booked this" 409.
   *
   * Only the two timestamps are selected. No participant id, application id, or
   * any other attribute of another user's booking leaves this method — the
   * caller learns "this range is taken", which is exactly what a calendar
   * discloses and nothing more.
   */
  private async listBusyForConsultant(
    consultantId: string,
    from: string,
    to: string,
  ): Promise<{ start: string; end: string }[]> {
    return this.repo.listBusy(this.supabase.admin, consultantId, from, to);
  }

  /**
   * An application id may only be attached to a booking by its owner. The
   * INSERT policy only checks `auth.uid() = user_id`, so without this a caller
   * could staple someone else's application to their own consultation and
   * pollute that consultant's queue.
   */
  private async assertOwnsApplication(
    token: string,
    applicationId: string | undefined,
  ): Promise<void> {
    if (!applicationId) return;
    const db = this.supabase.forUser(token);
    const { data, error } = await db
      .from('applications')
      .select('id')
      .eq('id', applicationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    // RLS already hides other people's applications, so "not visible" and
    // "does not exist" are the same answer — and must look the same.
    if (!data) throw new NotFoundException('Application not found');
  }

  /** Free slots for a consultant in [from, to). */
  async listSlots(
    token: string,
    consultantId: string,
    query: { from: string; to: string; slotMinutes: number },
  ): Promise<{ timezone: string; slots: Slot[] }> {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (to.getTime() <= from.getTime()) {
      throw new BadRequestException('`to` must be after `from`');
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
      throw new BadRequestException(
        `range may not exceed ${MAX_RANGE_DAYS} days`,
      );
    }

    const db = this.supabase.forUser(token);
    const schedule = await this.repo.getSchedule(db, consultantId);
    // No availability row, or the consultant closed their books: an empty list
    // is the honest answer — do not fabricate a default 9-5.
    if (!schedule || !schedule.acceptingNew) {
      return { timezone: schedule?.timezone ?? 'UTC', slots: [] };
    }

    const busy = await this.listBusyForConsultant(
      consultantId,
      from.toISOString(),
      to.toISOString(),
    );

    return {
      timezone: schedule.timezone,
      slots: computeSlots({
        timezone: schedule.timezone,
        workingHours: schedule.workingHours,
        from: from.toISOString(),
        to: to.toISOString(),
        slotMinutes: query.slotMinutes,
        busy,
      }),
    };
  }

  async book(
    token: string,
    caller: BookingCaller,
    dto: CreateBookingDto,
  ): Promise<Consultation> {
    const start = new Date(dto.scheduledStart);
    const end = new Date(dto.scheduledEnd);
    if (end.getTime() <= start.getTime()) {
      throw new BadRequestException(
        'scheduledEnd must be after scheduledStart',
      );
    }
    if (start.getTime() < Date.now()) {
      throw new BadRequestException('cannot book a time in the past');
    }

    const db = this.supabase.forUser(token);
    await this.assertOwnsApplication(token, dto.applicationId);
    const schedule = await this.repo.getSchedule(db, dto.consultantId);
    if (!schedule)
      throw new NotFoundException('Consultant has no published availability');
    if (!schedule.acceptingNew) {
      throw new ConflictException('Consultant is not accepting new bookings');
    }

    const busy = await this.listBusyForConsultant(
      dto.consultantId,
      new Date(start.getTime() - DAY_MS).toISOString(),
      new Date(end.getTime() + DAY_MS).toISOString(),
    );

    // Re-validate server-side. The slot list the client rendered may be stale,
    // and a hand-crafted request never went through it at all.
    const durationMinutes = Math.round(
      (end.getTime() - start.getTime()) / 60000,
    );
    const ok = isBookable(start.toISOString(), end.toISOString(), {
      timezone: schedule.timezone,
      workingHours: schedule.workingHours,
      slotMinutes: durationMinutes,
      busy,
    });
    if (!ok) throw new ConflictException('That time is no longer available');

    try {
      return await this.repo.create(db, {
        consultantId: dto.consultantId,
        userId: caller.id,
        applicationId: dto.applicationId ?? null,
        provider: dto.provider,
        scheduledStart: start.toISOString(),
        scheduledEnd: end.toISOString(),
        timezone: dto.timezone,
      });
    } catch (err) {
      // consultations_no_overlap (exclusion constraint) is the last line of
      // defence when two applicants race for the same slot.
      const message = (err as Error).message ?? '';
      if (
        message.includes('consultations_no_overlap') ||
        message.includes('exclusion')
      ) {
        throw new ConflictException(
          'That time was just booked by someone else',
        );
      }
      throw err;
    }
  }

  list(token: string, caller: BookingCaller): Promise<Consultation[]> {
    return this.repo.listForUser(this.supabase.forUser(token), caller.id);
  }

  async cancel(
    token: string,
    caller: BookingCaller,
    id: string,
  ): Promise<Consultation> {
    const db = this.supabase.forUser(token);
    const existing = await this.repo.getById(db, id);
    // RLS already hides other people's rows; a null here means "not yours or
    // not there", and both must look identical so the endpoint cannot be used
    // to probe for the existence of a booking id.
    if (!existing) throw new NotFoundException('Consultation not found');
    if (existing.status === 'cancelled') return existing;
    if (existing.status === 'completed') {
      throw new ConflictException(
        'A completed consultation cannot be cancelled',
      );
    }
    if (
      new Date(existing.scheduled_start).getTime() - Date.now() <
      CANCEL_CUTOFF_MS
    ) {
      throw new ConflictException(
        'Consultations cannot be cancelled less than 2 hours before the start time',
      );
    }
    this.log.log(`consultation ${id} cancelled by ${caller.id}`);
    return this.repo.updateStatus(db, id, 'cancelled');
  }

  async reschedule(
    token: string,
    caller: BookingCaller,
    id: string,
    dto: RescheduleBookingDto,
  ): Promise<Consultation> {
    const db = this.supabase.forUser(token);
    const existing = await this.repo.getById(db, id);
    if (!existing) throw new NotFoundException('Consultation not found');
    if (existing.status === 'completed' || existing.status === 'cancelled') {
      throw new ConflictException(
        `A ${existing.status} consultation cannot be rescheduled`,
      );
    }

    const start = new Date(dto.scheduledStart);
    const end = new Date(dto.scheduledEnd);
    if (end.getTime() <= start.getTime()) {
      throw new BadRequestException(
        'scheduledEnd must be after scheduledStart',
      );
    }
    if (start.getTime() < Date.now()) {
      throw new BadRequestException('cannot reschedule into the past');
    }

    const schedule = await this.repo.getSchedule(db, existing.consultant_id);
    if (!schedule)
      throw new NotFoundException('Consultant has no published availability');
    // A move is a new booking in every respect except the row id, so it honours
    // the same gates: the consultant must still be open, and the applicant must
    // not use "reschedule" to route around the cancellation cutoff.
    if (!schedule.acceptingNew) {
      throw new ConflictException('Consultant is not accepting new bookings');
    }
    if (
      new Date(existing.scheduled_start).getTime() - Date.now() <
      CANCEL_CUTOFF_MS
    ) {
      throw new ConflictException(
        'Consultations cannot be rescheduled less than 2 hours before the start time',
      );
    }

    const busy = (
      await this.listBusyForConsultant(
        existing.consultant_id,
        new Date(start.getTime() - DAY_MS).toISOString(),
        new Date(end.getTime() + DAY_MS).toISOString(),
      )
    ).filter(
      // The booking being moved must not block itself.
      (b) =>
        !(
          b.start === existing.scheduled_start &&
          b.end === existing.scheduled_end
        ),
    );

    const durationMinutes = Math.round(
      (end.getTime() - start.getTime()) / 60000,
    );
    if (
      !isBookable(start.toISOString(), end.toISOString(), {
        timezone: schedule.timezone,
        workingHours: schedule.workingHours,
        slotMinutes: durationMinutes,
        busy,
      })
    ) {
      throw new ConflictException('That time is not available');
    }

    this.log.log(`consultation ${id} rescheduled by ${caller.id}`);
    try {
      return await this.repo.reschedule(db, id, {
        scheduledStart: start.toISOString(),
        scheduledEnd: end.toISOString(),
        timezone: dto.timezone,
      });
    } catch (err) {
      // Same exclusion-constraint race as book(); a 500 here would be wrong.
      const message = (err as Error).message ?? '';
      if (
        message.includes('consultations_no_overlap') ||
        message.includes('exclusion')
      ) {
        throw new ConflictException(
          'That time was just booked by someone else',
        );
      }
      throw err;
    }
  }
}
