import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConsultationsService } from './consultations.service';
import type { IConsultationsRepository } from './consultations.repository';
import type { SupabaseService } from '../shared/supabase/supabase.service';

const TORONTO = 'America/Toronto';
// A Monday well in the future so "not in the past" checks never flake.
const MONDAY = '2027-01-11';
const START = `${MONDAY}T14:00:00.000Z`; // 09:00 Toronto (EST)
const END = `${MONDAY}T15:00:00.000Z`;

function setup(
  over: {
    schedule?: unknown;
    busy?: { start: string; end: string }[];
    existing?: unknown;
    createError?: Error;
  } = {},
) {
  const repo = {
    getSchedule: jest.fn().mockResolvedValue(
      over.schedule === undefined
        ? {
            consultantId: 'c1',
            timezone: TORONTO,
            workingHours: { mon: [['09:00', '17:00']] },
            acceptingNew: true,
          }
        : over.schedule,
    ),
    listBusy: jest.fn().mockResolvedValue(over.busy ?? []),
    create: over.createError
      ? jest.fn().mockRejectedValue(over.createError)
      : jest
          .fn()
          .mockImplementation(async (_db, input) => ({ id: 'new', ...input })),
    listForUser: jest.fn().mockResolvedValue([]),
    getById: jest.fn().mockResolvedValue(over.existing ?? null),
    updateStatus: jest
      .fn()
      .mockImplementation(async (_db, id, status) => ({ id, status })),
    reschedule: jest
      .fn()
      .mockImplementation(async (_db, id, t) => ({ id, ...t })),
  } as unknown as jest.Mocked<IConsultationsRepository>;

  const forUser = jest.fn().mockReturnValue({ __scoped: true });
  const supabase = {
    forUser,
    admin: { __admin: true },
  } as unknown as SupabaseService;
  return { svc: new ConsultationsService(repo, supabase), repo, forUser };
}

const caller = { id: 'user-1' };
const dto = {
  consultantId: '11111111-1111-4111-8111-111111111111',
  scheduledStart: START,
  scheduledEnd: END,
  timezone: TORONTO,
  provider: 'zoom' as const,
};

describe('ConsultationsService.listSlots', () => {
  it('uses the RLS-scoped client, never the service-role client', async () => {
    const { svc, forUser } = setup();
    await svc.listSlots('jwt-abc', 'c1', {
      from: `${MONDAY}T00:00:00Z`,
      to: `${MONDAY}T23:59:00Z`,
      slotMinutes: 60,
    });
    expect(forUser).toHaveBeenCalledWith('jwt-abc');
  });

  it('returns slots inside the consultant working window', async () => {
    const { svc } = setup();
    const res = await svc.listSlots('jwt', 'c1', {
      from: `${MONDAY}T00:00:00Z`,
      to: `${MONDAY}T23:59:00Z`,
      slotMinutes: 60,
    });
    expect(res.timezone).toBe(TORONTO);
    expect(res.slots[0]?.start).toBe(START);
  });

  it('returns an empty list when the consultant has no availability row', async () => {
    const { svc } = setup({ schedule: null });
    const res = await svc.listSlots('jwt', 'c1', {
      from: `${MONDAY}T00:00:00Z`,
      to: `${MONDAY}T23:59:00Z`,
      slotMinutes: 60,
    });
    expect(res.slots).toEqual([]);
  });

  it('returns an empty list when the consultant stopped accepting bookings', async () => {
    const { svc } = setup({
      schedule: {
        consultantId: 'c1',
        timezone: TORONTO,
        workingHours: { mon: [['09:00', '17:00']] },
        acceptingNew: false,
      },
    });
    const res = await svc.listSlots('jwt', 'c1', {
      from: `${MONDAY}T00:00:00Z`,
      to: `${MONDAY}T23:59:00Z`,
      slotMinutes: 60,
    });
    expect(res.slots).toEqual([]);
  });

  it('rejects an inverted range', async () => {
    const { svc } = setup();
    await expect(
      svc.listSlots('jwt', 'c1', {
        from: `${MONDAY}T10:00:00Z`,
        to: `${MONDAY}T09:00:00Z`,
        slotMinutes: 60,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unbounded range that would blow up the response', async () => {
    const { svc } = setup();
    await expect(
      svc.listSlots('jwt', 'c1', {
        from: '2027-01-01T00:00:00Z',
        to: '2028-01-01T00:00:00Z',
        slotMinutes: 15,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ConsultationsService.book', () => {
  it('creates a requested booking owned by the caller', async () => {
    const { svc, repo } = setup();
    const result = await svc.book('jwt', caller, dto);
    expect(repo.create).toHaveBeenCalledWith(
      { __scoped: true },
      expect.objectContaining({
        userId: 'user-1',
        consultantId: dto.consultantId,
      }),
    );
    expect(result).toBeDefined();
  });

  it('rejects a time outside the consultant working hours', async () => {
    const { svc } = setup();
    await expect(
      svc.book('jwt', caller, {
        ...dto,
        scheduledStart: `${MONDAY}T06:00:00.000Z`, // 01:00 Toronto
        scheduledEnd: `${MONDAY}T07:00:00.000Z`,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a slot that already has a booking', async () => {
    const { svc } = setup({ busy: [{ start: START, end: END }] });
    await expect(svc.book('jwt', caller, dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects a booking in the past', async () => {
    const { svc } = setup();
    await expect(
      svc.book('jwt', caller, {
        ...dto,
        scheduledStart: '2020-01-06T14:00:00.000Z',
        scheduledEnd: '2020-01-06T15:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an inverted time range', async () => {
    const { svc } = setup();
    await expect(
      svc.book('jwt', caller, {
        ...dto,
        scheduledStart: END,
        scheduledEnd: START,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s when the consultant published no availability', async () => {
    const { svc } = setup({ schedule: null });
    await expect(svc.book('jwt', caller, dto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('409s when the consultant is not accepting new bookings', async () => {
    const { svc } = setup({
      schedule: {
        consultantId: 'c1',
        timezone: TORONTO,
        workingHours: { mon: [['09:00', '17:00']] },
        acceptingNew: false,
      },
    });
    await expect(svc.book('jwt', caller, dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('translates the DB exclusion-constraint race into a 409', async () => {
    const { svc } = setup({
      createError: new Error(
        'conflicting key value violates exclusion constraint "consultations_no_overlap"',
      ),
    });
    await expect(svc.book('jwt', caller, dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('ConsultationsService.cancel', () => {
  const future = new Date(Date.now() + 5 * 3600_000).toISOString();

  it('cancels a future booking', async () => {
    const { svc, repo } = setup({
      existing: {
        id: 'b1',
        status: 'confirmed',
        scheduled_start: future,
        consultant_id: 'c1',
      },
    });
    await svc.cancel('jwt', caller, 'b1');
    expect(repo.updateStatus).toHaveBeenCalledWith(
      { __scoped: true },
      'b1',
      'cancelled',
    );
  });

  it('404s for a booking the caller cannot see (RLS-filtered)', async () => {
    const { svc } = setup({ existing: null });
    await expect(svc.cancel('jwt', caller, 'b1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('is idempotent for an already-cancelled booking', async () => {
    const { svc, repo } = setup({
      existing: {
        id: 'b1',
        status: 'cancelled',
        scheduled_start: future,
        consultant_id: 'c1',
      },
    });
    await svc.cancel('jwt', caller, 'b1');
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it('refuses to cancel a completed consultation', async () => {
    const { svc } = setup({
      existing: {
        id: 'b1',
        status: 'completed',
        scheduled_start: future,
        consultant_id: 'c1',
      },
    });
    await expect(svc.cancel('jwt', caller, 'b1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses to cancel inside the 2-hour cutoff', async () => {
    const { svc } = setup({
      existing: {
        id: 'b1',
        status: 'confirmed',
        scheduled_start: new Date(Date.now() + 30 * 60_000).toISOString(),
        consultant_id: 'c1',
      },
    });
    await expect(svc.cancel('jwt', caller, 'b1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('ConsultationsService.reschedule', () => {
  const existing = {
    id: 'b1',
    status: 'confirmed',
    consultant_id: 'c1',
    scheduled_start: START,
    scheduled_end: END,
  };
  const next = {
    scheduledStart: `${MONDAY}T16:00:00.000Z`, // 11:00 Toronto
    scheduledEnd: `${MONDAY}T17:00:00.000Z`,
    timezone: TORONTO,
  };

  it('moves the booking and returns it to `requested` for re-confirmation', async () => {
    const { svc, repo } = setup({ existing });
    await svc.reschedule('jwt', caller, 'b1', next);
    expect(repo.reschedule).toHaveBeenCalledWith(
      { __scoped: true },
      'b1',
      expect.objectContaining({ scheduledStart: next.scheduledStart }),
    );
  });

  it('does not treat the booking being moved as a conflict with itself', async () => {
    const { svc, repo } = setup({
      existing,
      busy: [{ start: START, end: END }],
    });
    await svc.reschedule('jwt', caller, 'b1', next);
    expect(repo.reschedule).toHaveBeenCalled();
  });

  it('rejects a move onto a slot held by a different booking', async () => {
    const { svc } = setup({
      existing,
      busy: [{ start: next.scheduledStart, end: next.scheduledEnd }],
    });
    await expect(
      svc.reschedule('jwt', caller, 'b1', next),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to reschedule a cancelled booking', async () => {
    const { svc } = setup({ existing: { ...existing, status: 'cancelled' } });
    await expect(
      svc.reschedule('jwt', caller, 'b1', next),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('404s when the booking is not visible to the caller', async () => {
    const { svc } = setup({ existing: null });
    await expect(
      svc.reschedule('jwt', caller, 'b1', next),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
