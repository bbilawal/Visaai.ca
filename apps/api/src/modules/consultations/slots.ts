/**
 * Availability → bookable slots. Pure functions, no I/O, so the timezone and
 * DST behaviour is directly testable (see slots.spec.ts).
 *
 * `consultant_availability.working_hours` stores *wall-clock* windows in the
 * consultant's IANA timezone: { mon: [["09:00","17:00"]], ... }. Applicants
 * book from anywhere on earth, so every window must be resolved to an absolute
 * UTC instant before it can be compared with existing bookings — a naive
 * `new Date("2026-03-08T09:00")` would silently use the *server's* zone and put
 * meetings in the wrong hour for most of the year.
 */
export type Weekday = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export type WorkingHours = Partial<Record<Weekday, [string, string][]>>;

export interface Busy {
  start: string; // ISO 8601 UTC
  end: string;
}

export interface Slot {
  start: string; // ISO 8601 UTC
  end: string;
}

export interface SlotOptions {
  timezone: string;
  workingHours: WorkingHours;
  /** Inclusive window start (ISO). */
  from: string;
  /** Exclusive window end (ISO). */
  to: string;
  slotMinutes: number;
  busy: Busy[];
  /** Slots starting before this instant are dropped (default: now). */
  notBefore?: Date;
  /** Hard cap on returned slots so a wide range cannot blow up a response. */
  maxSlots?: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * Offset (ms) to add to a UTC instant to get wall-clock time in `tz`.
 * Uses Intl rather than a tz database dependency — Node ships full ICU.
 */
export function tzOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(instant);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    // Intl emits hour 24 for midnight under hour12:false in some ICU versions.
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return asUtc - instant.getTime();
}

/**
 * Wall-clock time in `timeZone` → absolute UTC Date.
 *
 * Two passes: the first guess uses the offset at the *approximate* instant, the
 * second re-resolves using the offset actually in force at that instant. This
 * is what makes spring-forward / fall-back transitions land correctly instead
 * of drifting by an hour for the day around the change.
 */
export function zonedTimeToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offset1 = tzOffsetMs(new Date(guess), timeZone);
  const candidate = new Date(guess - offset1);
  const offset2 = tzOffsetMs(candidate, timeZone);
  return offset1 === offset2 ? candidate : new Date(guess - offset2);
}

/** Calendar parts of `instant` as seen in `timeZone`. */
function zonedParts(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number; weekday: Weekday } {
  const shifted = new Date(instant.getTime() + tzOffsetMs(instant, timeZone));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: WEEKDAYS[shifted.getUTCDay()],
  };
}

function parseHhMm(value: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  // 24:00 is a legitimate end-of-day marker in a [start,end) window.
  if (hour < 0 || hour > 24 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Expand working hours across [from, to) into discrete, non-overlapping slots,
 * dropping anything that collides with an existing booking or is already past.
 */
export function computeSlots(options: SlotOptions): Slot[] {
  const { timezone, workingHours, slotMinutes, busy, maxSlots = 500 } = options;

  const from = new Date(options.from);
  const to = new Date(options.to);
  const notBefore = options.notBefore ?? new Date();
  if (
    Number.isNaN(from.getTime()) ||
    Number.isNaN(to.getTime()) ||
    to.getTime() <= from.getTime() ||
    slotMinutes <= 0
  ) {
    return [];
  }

  const busyRanges = busy
    .map(
      (b) => [new Date(b.start).getTime(), new Date(b.end).getTime()] as const,
    )
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s);

  const slots: Slot[] = [];
  const slotMs = slotMinutes * MINUTE_MS;

  // Walk calendar days in the consultant's zone. Start one day early: a window
  // late in the consultant's day can begin *before* `from` in UTC terms yet
  // still contain bookable time inside the requested range.
  for (
    let cursor = from.getTime() - DAY_MS;
    cursor <= to.getTime() + DAY_MS;
    cursor += DAY_MS
  ) {
    const { year, month, day, weekday } = zonedParts(
      new Date(cursor),
      timezone,
    );
    const windows = workingHours[weekday] ?? [];

    for (const window of windows) {
      const start = parseHhMm(window[0] ?? '');
      const end = parseHhMm(window[1] ?? '');
      if (!start || !end) continue;

      const windowStart = zonedTimeToUtc(
        year,
        month,
        day,
        start.hour,
        start.minute,
        timezone,
      );
      const windowEnd = zonedTimeToUtc(
        year,
        month,
        day,
        end.hour,
        end.minute,
        timezone,
      );
      if (windowEnd.getTime() <= windowStart.getTime()) continue;

      for (
        let t = windowStart.getTime();
        t + slotMs <= windowEnd.getTime();
        t += slotMs
      ) {
        const slotEnd = t + slotMs;
        if (t < from.getTime() || slotEnd > to.getTime()) continue;
        if (t < notBefore.getTime()) continue;
        if (busyRanges.some(([bs, be]) => overlaps(t, slotEnd, bs, be)))
          continue;

        slots.push({
          start: new Date(t).toISOString(),
          end: new Date(slotEnd).toISOString(),
        });
      }
    }
  }

  // The day-walk can emit the same slot twice around a DST fold; dedupe, sort,
  // then cap.
  const unique = new Map(slots.map((s) => [s.start, s]));
  return [...unique.values()]
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, maxSlots);
}

/**
 * Is [start, end) fully contained in a working-hours window and free of
 * conflicts? Booking re-validates server-side: the slot list the client saw may
 * be minutes stale, and a hand-crafted request never passed through it at all.
 */
export function isBookable(
  start: string,
  end: string,
  options: Omit<SlotOptions, 'from' | 'to'>,
): boolean {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return false;

  const candidates = computeSlots({
    ...options,
    from: new Date(s - DAY_MS).toISOString(),
    to: new Date(e + DAY_MS).toISOString(),
    maxSlots: 5000,
  });
  return candidates.some(
    (slot) =>
      slot.start === new Date(s).toISOString() &&
      slot.end === new Date(e).toISOString(),
  );
}
