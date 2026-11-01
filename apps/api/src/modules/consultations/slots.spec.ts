import { computeSlots, isBookable, tzOffsetMs, zonedTimeToUtc } from './slots';

const TORONTO = 'America/Toronto';
const KOLKATA = 'Asia/Kolkata'; // UTC+5:30 — catches half-hour-offset bugs

describe('tzOffsetMs', () => {
  it('reports EST (-5h) in January', () => {
    expect(tzOffsetMs(new Date('2026-01-15T12:00:00Z'), TORONTO)).toBe(
      -5 * 3600_000,
    );
  });

  it('reports EDT (-4h) in July', () => {
    expect(tzOffsetMs(new Date('2026-07-15T12:00:00Z'), TORONTO)).toBe(
      -4 * 3600_000,
    );
  });

  it('handles half-hour zones', () => {
    expect(tzOffsetMs(new Date('2026-01-15T12:00:00Z'), KOLKATA)).toBe(
      5.5 * 3600_000,
    );
  });
});

describe('zonedTimeToUtc', () => {
  it('resolves winter wall time to UTC', () => {
    expect(zonedTimeToUtc(2026, 1, 15, 9, 0, TORONTO).toISOString()).toBe(
      '2026-01-15T14:00:00.000Z',
    );
  });

  it('resolves summer wall time to UTC (DST applied)', () => {
    expect(zonedTimeToUtc(2026, 7, 15, 9, 0, TORONTO).toISOString()).toBe(
      '2026-07-15T13:00:00.000Z',
    );
  });

  it('resolves the day of spring-forward with the post-transition offset', () => {
    // 2026-03-08 is the US/Canada DST start. 09:00 local is EDT (-4), not EST.
    expect(zonedTimeToUtc(2026, 3, 8, 9, 0, TORONTO).toISOString()).toBe(
      '2026-03-08T13:00:00.000Z',
    );
  });
});

describe('computeSlots', () => {
  const base = {
    timezone: TORONTO,
    workingHours: { mon: [['09:00', '11:00']] as [string, string][] },
    slotMinutes: 60,
    busy: [],
    notBefore: new Date('2020-01-01T00:00:00Z'),
  };

  it('expands a window into fixed-length slots', () => {
    const slots = computeSlots({
      ...base,
      from: '2026-01-12T00:00:00Z', // Monday
      to: '2026-01-13T00:00:00Z',
    });
    expect(slots).toEqual([
      { start: '2026-01-12T14:00:00.000Z', end: '2026-01-12T15:00:00.000Z' },
      { start: '2026-01-12T15:00:00.000Z', end: '2026-01-12T16:00:00.000Z' },
    ]);
  });

  it('returns nothing for a weekday with no configured hours', () => {
    const slots = computeSlots({
      ...base,
      from: '2026-01-13T00:00:00Z', // Tuesday
      to: '2026-01-14T00:00:00Z',
    });
    expect(slots).toEqual([]);
  });

  it('drops slots overlapping an existing booking', () => {
    const slots = computeSlots({
      ...base,
      from: '2026-01-12T00:00:00Z',
      to: '2026-01-13T00:00:00Z',
      busy: [{ start: '2026-01-12T14:30:00Z', end: '2026-01-12T15:00:00Z' }],
    });
    expect(slots.map((s) => s.start)).toEqual(['2026-01-12T15:00:00.000Z']);
  });

  it('treats a booking that merely touches the boundary as non-conflicting', () => {
    const slots = computeSlots({
      ...base,
      from: '2026-01-12T00:00:00Z',
      to: '2026-01-13T00:00:00Z',
      busy: [{ start: '2026-01-12T13:00:00Z', end: '2026-01-12T14:00:00Z' }],
    });
    expect(slots).toHaveLength(2);
  });

  it('drops slots that start in the past', () => {
    const slots = computeSlots({
      ...base,
      from: '2026-01-12T00:00:00Z',
      to: '2026-01-13T00:00:00Z',
      notBefore: new Date('2026-01-12T14:30:00Z'),
    });
    expect(slots.map((s) => s.start)).toEqual(['2026-01-12T15:00:00.000Z']);
  });

  it('shifts with DST: the same 09:00 local window is an hour earlier in UTC in summer', () => {
    const summer = computeSlots({
      ...base,
      from: '2026-07-13T00:00:00Z', // Monday
      to: '2026-07-14T00:00:00Z',
    });
    expect(summer[0]?.start).toBe('2026-07-13T13:00:00.000Z');
  });

  it('handles a half-hour-offset timezone', () => {
    const slots = computeSlots({
      ...base,
      timezone: KOLKATA,
      from: '2026-01-12T00:00:00Z',
      to: '2026-01-13T00:00:00Z',
    });
    expect(slots[0]?.start).toBe('2026-01-12T03:30:00.000Z');
  });

  it('excludes a partial slot that does not fit inside the window', () => {
    const slots = computeSlots({
      ...base,
      workingHours: { mon: [['09:00', '10:30']] },
      from: '2026-01-12T00:00:00Z',
      to: '2026-01-13T00:00:00Z',
    });
    expect(slots).toHaveLength(1);
  });

  it('ignores malformed working-hours entries instead of throwing', () => {
    const slots = computeSlots({
      ...base,
      workingHours: {
        mon: [
          ['nine', '11:00'],
          ['09:00', '11:00'],
        ],
      },
      from: '2026-01-12T00:00:00Z',
      to: '2026-01-13T00:00:00Z',
    });
    expect(slots).toHaveLength(2);
  });

  it('ignores an inverted window', () => {
    const slots = computeSlots({
      ...base,
      workingHours: { mon: [['17:00', '09:00']] },
      from: '2026-01-12T00:00:00Z',
      to: '2026-01-13T00:00:00Z',
    });
    expect(slots).toEqual([]);
  });

  it('returns [] for an inverted requested range', () => {
    expect(
      computeSlots({
        ...base,
        from: '2026-01-13T00:00:00Z',
        to: '2026-01-12T00:00:00Z',
      }),
    ).toEqual([]);
  });

  it('caps the number of returned slots', () => {
    const slots = computeSlots({
      ...base,
      workingHours: {
        mon: [['00:00', '24:00']],
        tue: [['00:00', '24:00']],
        wed: [['00:00', '24:00']],
      },
      slotMinutes: 15,
      from: '2026-01-12T00:00:00Z',
      to: '2026-01-15T00:00:00Z',
      maxSlots: 10,
    });
    expect(slots).toHaveLength(10);
  });

  it('emits no duplicate start times', () => {
    const slots = computeSlots({
      ...base,
      workingHours: { mon: [['09:00', '17:00']] },
      from: '2026-01-12T00:00:00Z',
      to: '2026-01-13T00:00:00Z',
    });
    expect(new Set(slots.map((s) => s.start)).size).toBe(slots.length);
  });
});

describe('isBookable', () => {
  const opts = {
    timezone: TORONTO,
    workingHours: { mon: [['09:00', '11:00']] as [string, string][] },
    slotMinutes: 60,
    busy: [],
    notBefore: new Date('2020-01-01T00:00:00Z'),
  };

  it('accepts a slot that lines up with the grid', () => {
    expect(
      isBookable('2026-01-12T14:00:00.000Z', '2026-01-12T15:00:00.000Z', opts),
    ).toBe(true);
  });

  it('rejects an off-grid start time', () => {
    expect(
      isBookable('2026-01-12T14:15:00.000Z', '2026-01-12T15:15:00.000Z', opts),
    ).toBe(false);
  });

  it('rejects a slot outside working hours', () => {
    expect(
      isBookable('2026-01-12T20:00:00.000Z', '2026-01-12T21:00:00.000Z', opts),
    ).toBe(false);
  });

  it('rejects a slot that is already booked', () => {
    expect(
      isBookable('2026-01-12T14:00:00.000Z', '2026-01-12T15:00:00.000Z', {
        ...opts,
        busy: [{ start: '2026-01-12T14:00:00Z', end: '2026-01-12T15:00:00Z' }],
      }),
    ).toBe(false);
  });

  it('rejects a zero-length or inverted range', () => {
    expect(
      isBookable('2026-01-12T14:00:00.000Z', '2026-01-12T14:00:00.000Z', opts),
    ).toBe(false);
    expect(
      isBookable('2026-01-12T15:00:00.000Z', '2026-01-12T14:00:00.000Z', opts),
    ).toBe(false);
  });

  it('rejects a slot in the past', () => {
    expect(
      isBookable('2026-01-12T14:00:00.000Z', '2026-01-12T15:00:00.000Z', {
        ...opts,
        notBefore: new Date('2026-06-01T00:00:00Z'),
      }),
    ).toBe(false);
  });
});
