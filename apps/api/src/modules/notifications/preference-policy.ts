import type {
  NotificationPreferences,
  NotificationCategory,
} from '@visaai/types';

/**
 * Which channels a notification should use, and how long to defer the
 * interruptive ones (email/push) for quiet hours.
 *
 * Rules (pure, deterministic given a fixed `now`):
 *  - In-app is ALWAYS delivered — the feed is the system of record; neither a
 *    category opt-out nor quiet hours can suppress it.
 *  - Category opt-out: `categories[category] === false` mutes email + push
 *    (absent / `true` = ON — opt-OUT semantics).
 *  - `email_enabled` / `push_enabled` are per-channel master switches.
 *  - Quiet hours DELAY email/push (BullMQ `delay`), never drop them: if `now`
 *    (in the recipient's `timezone`) falls inside `[start, end)` (wrapping past
 *    midnight), `delayMs` is the time until the window ends.
 */
export interface ChannelDecision {
  inApp: boolean;
  email: boolean;
  push: boolean;
  sms: boolean;
  delayMs: number;
}

/**
 * Wall-clock hour/minute/second in the recipient's tz; falls back to UTC on a
 * bad tz. Minute/second must be read in the SAME tz as the hour — fractional
 * offsets (Asia/Kolkata +5:30, Asia/Kathmandu +5:45, America/St_Johns −3:30)
 * shift the minute-of-hour, so mixing a tz hour with UTC minutes would release
 * quiet-hours email/push up to 45 min early/late.
 */
function wallClockInTz(
  now: Date,
  tz: string | null,
): { hour: number; minute: number; second: number } {
  const utc = {
    hour: now.getUTCHours(),
    minute: now.getUTCMinutes(),
    second: now.getUTCSeconds(),
  };
  if (!tz) return utc;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: tz,
    }).formatToParts(now);
    const get = (t: string): number => {
      const p = parts.find((x) => x.type === t)?.value;
      const n = p === undefined ? NaN : parseInt(p, 10);
      return Number.isFinite(n) ? n : NaN;
    };
    const hour = get('hour');
    const minute = get('minute');
    const second = get('second');
    if (![hour, minute, second].every(Number.isFinite)) return utc;
    return { hour: hour % 24, minute, second };
  } catch {
    return utc;
  }
}

/** Whether `h` is inside `[start, end)`, handling a window that wraps midnight. */
function inQuiet(h: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? h >= start && h < end : h >= start || h < end;
}

export function decideChannels(input: {
  prefs: NotificationPreferences;
  category: NotificationCategory;
  now: Date;
}): ChannelDecision {
  const { prefs, category, now } = input;
  const categoryOn = prefs.categories?.[category] !== false;
  const email = prefs.email_enabled && categoryOn;
  const push = prefs.push_enabled && categoryOn;
  // SMS is opt-IN (default off): only when sms_enabled === true.
  const sms = prefs.sms_enabled === true && categoryOn;

  let delayMs = 0;
  if (
    (email || push || sms) &&
    prefs.quiet_hours_start != null &&
    prefs.quiet_hours_end != null
  ) {
    const { hour, minute, second } = wallClockInTz(now, prefs.timezone);
    if (inQuiet(hour, prefs.quiet_hours_start, prefs.quiet_hours_end)) {
      const hoursLeft = (prefs.quiet_hours_end - hour + 24) % 24 || 24;
      // Subtract the minute/second already elapsed in THIS tz so the notification
      // is released at the top of the quiet-window's end hour, not offset by the
      // recipient's fractional-hour zone.
      delayMs = hoursLeft * 3_600_000 - minute * 60_000 - second * 1000;
      if (delayMs < 0) delayMs = 0;
    }
  }

  return { inApp: true, email, push, sms, delayMs };
}
