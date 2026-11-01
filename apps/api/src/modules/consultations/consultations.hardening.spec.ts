import { CreateBookingDto, RescheduleBookingDto } from './consultations.dto';
import { ConsultationsService } from './consultations.service';
import type { IConsultationsRepository } from './consultations.repository';
import type { SupabaseService } from '../shared/supabase/supabase.service';

/**
 * Regression tests for the two defects an independent review found in the
 * booking module. Both were invisible to the original suite: the DoS because no
 * test supplied a hostile date, and the busy-lookup because the repository was
 * mocked, which hid the fact that RLS returns nothing to an applicant.
 */
const TORONTO = 'America/Toronto';
const CONSULTANT = '11111111-1111-4111-8111-111111111111';

describe('CreateBookingDto — denial-of-service bounds', () => {
  const base = {
    consultantId: CONSULTANT,
    timezone: TORONTO,
    scheduledStart: '2027-01-11T14:00:00.000Z',
    scheduledEnd: '2027-01-11T15:00:00.000Z',
  };

  it('accepts an ordinary one-hour booking', () => {
    expect(CreateBookingDto.safeParse(base).success).toBe(true);
  });

  it('REJECTS an absurd far-future end date', () => {
    // `Date.parse("+275760-09-13T00:00:00Z")` is valid, and the availability
    // check day-walks the range — one request span the event loop for ~10^8
    // iterations and took the whole API process down.
    const result = CreateBookingDto.safeParse({
      ...base,
      scheduledEnd: '+275760-09-13T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a booking longer than the maximum consultation', () => {
    const result = CreateBookingDto.safeParse({
      ...base,
      scheduledEnd: '2027-01-11T23:00:00.000Z', // 9 hours
    });
    expect(result.success).toBe(false);
  });

  it('rejects a start beyond the booking horizon', () => {
    const farFuture = new Date(Date.now() + 400 * 86_400_000);
    const result = CreateBookingDto.safeParse({
      ...base,
      scheduledStart: farFuture.toISOString(),
      scheduledEnd: new Date(farFuture.getTime() + 3600_000).toISOString(),
    });
    expect(result.success).toBe(false);
  });

  it('rejects an inverted range', () => {
    const result = CreateBookingDto.safeParse({
      ...base,
      scheduledStart: base.scheduledEnd,
      scheduledEnd: base.scheduledStart,
    });
    expect(result.success).toBe(false);
  });

  it('applies the same bounds to reschedule', () => {
    expect(
      RescheduleBookingDto.safeParse({
        scheduledStart: base.scheduledStart,
        scheduledEnd: '+275760-09-13T00:00:00.000Z',
        timezone: TORONTO,
      }).success,
    ).toBe(false);
  });
});

describe('ConsultationsService — busy lookup must bypass RLS', () => {
  function setup() {
    const repo = {
      getSchedule: jest.fn().mockResolvedValue({
        consultantId: CONSULTANT,
        timezone: TORONTO,
        workingHours: { mon: [['09:00', '17:00']] },
        acceptingNew: true,
      }),
      listBusy: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'new' }),
      listForUser: jest.fn().mockResolvedValue([]),
      getById: jest.fn().mockResolvedValue(null),
      updateStatus: jest.fn(),
      reschedule: jest.fn(),
    } as unknown as jest.Mocked<IConsultationsRepository>;

    const admin = { __admin: true };
    const supabase = {
      forUser: jest.fn().mockReturnValue({ __scoped: true }),
      admin,
    } as unknown as SupabaseService;

    return { svc: new ConsultationsService(repo, supabase), repo, admin };
  }

  it('reads busy windows with the SERVICE-ROLE client', async () => {
    // `consultations_participant_read` only exposes the caller's own rows, so
    // the scoped client reports an empty calendar and every taken slot is
    // offered as free. This is the one deliberate RLS bypass in the service.
    const { svc, repo, admin } = setup();
    await svc.listSlots('jwt', CONSULTANT, {
      from: '2027-01-11T00:00:00Z',
      to: '2027-01-12T00:00:00Z',
      slotMinutes: 60,
    });
    expect(repo.listBusy).toHaveBeenCalledWith(
      admin,
      CONSULTANT,
      expect.any(String),
      expect.any(String),
    );
  });

  it('still reads the consultant schedule with the scoped client', async () => {
    const { svc, repo } = setup();
    await svc.listSlots('jwt', CONSULTANT, {
      from: '2027-01-11T00:00:00Z',
      to: '2027-01-12T00:00:00Z',
      slotMinutes: 60,
    });
    expect(repo.getSchedule).toHaveBeenCalledWith(
      { __scoped: true },
      CONSULTANT,
    );
  });
});
