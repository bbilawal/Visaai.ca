import { decideChannels } from './preference-policy';

const base = {
  user_id: 'u',
  email_enabled: true,
  push_enabled: true,
  sms_enabled: false,
  categories: {},
  quiet_hours_start: null,
  quiet_hours_end: null,
  timezone: null,
  language: null,
  updated_at: '',
} as const;

// ── Core invariant: in-app is ALWAYS true ──────────────────────────────────────

it('in-app always on; category opt-out mutes email/push', () => {
  const d = decideChannels({
    prefs: { ...base, categories: { billing: false } },
    category: 'billing',
    now: new Date(),
  });
  expect(d.inApp).toBe(true);
  expect(d.email).toBe(false);
  expect(d.push).toBe(false);
});

it('in-app is true even when email_enabled:false and push_enabled:false', () => {
  const d = decideChannels({
    prefs: { ...base, email_enabled: false, push_enabled: false },
    category: 'system',
    now: new Date(),
  });
  expect(d.inApp).toBe(true);
});

// ── Category absent/true = ON (opt-OUT semantics) ─────────────────────────────

it('unknown category (not in map) is treated as ON', () => {
  const d = decideChannels({
    prefs: { ...base, categories: {} },
    category: 'system',
    now: new Date(),
  });
  expect(d.email).toBe(true);
  expect(d.push).toBe(true);
  expect(d.inApp).toBe(true);
});

it('category present with value true is ON', () => {
  const d = decideChannels({
    prefs: { ...base, categories: { billing: true } },
    category: 'billing',
    now: new Date(),
  });
  expect(d.email).toBe(true);
  expect(d.push).toBe(true);
});

// ── email_enabled flag ─────────────────────────────────────────────────────────

it('email_enabled:false mutes email but not in-app', () => {
  const d = decideChannels({
    prefs: { ...base, email_enabled: false },
    category: 'system',
    now: new Date(),
  });
  expect(d.email).toBe(false);
  expect(d.inApp).toBe(true);
});

it('push_enabled:false mutes push but not in-app', () => {
  const d = decideChannels({
    prefs: { ...base, push_enabled: false },
    category: 'system',
    now: new Date(),
  });
  expect(d.push).toBe(false);
  expect(d.inApp).toBe(true);
});

// ── Quiet hours: OUT of window → delayMs 0 ────────────────────────────────────

it('no delay outside quiet hours', () => {
  const now = new Date('2026-07-01T12:00:00Z');
  const d = decideChannels({
    prefs: { ...base, quiet_hours_start: 22, quiet_hours_end: 7 },
    category: 'system',
    now,
  });
  expect(d.delayMs).toBe(0);
});

it('no delay when now is exactly at end of quiet window (boundary exclusive)', () => {
  const now = new Date('2026-07-01T07:00:00Z'); // exactly at end hour boundary
  const d = decideChannels({
    prefs: { ...base, quiet_hours_start: 22, quiet_hours_end: 7 },
    category: 'system',
    now,
  });
  expect(d.delayMs).toBe(0);
});

// ── Quiet hours: IN window → delay, never drop ────────────────────────────────

it('delays (not drops) during quiet hours with midnight wrap', () => {
  const now = new Date('2026-07-01T23:00:00Z');
  const d = decideChannels({
    prefs: {
      ...base,
      quiet_hours_start: 22,
      quiet_hours_end: 7,
      timezone: null,
    },
    category: 'system',
    now,
  });
  expect(d.email).toBe(true);
  expect(d.push).toBe(true);
  expect(d.delayMs).toBeGreaterThan(0);
});

it('delays during quiet hours in a simple non-wrapping window', () => {
  const now = new Date('2026-07-01T02:00:00Z'); // 02:00 UTC, inside 01:00–06:00
  const d = decideChannels({
    prefs: { ...base, quiet_hours_start: 1, quiet_hours_end: 6 },
    category: 'billing',
    now,
  });
  expect(d.email).toBe(true);
  expect(d.delayMs).toBeGreaterThan(0);
});

it('midnight wrap: hour 23 is inside start=22 end=7', () => {
  const now = new Date('2026-07-01T23:00:00Z');
  const d = decideChannels({
    prefs: { ...base, quiet_hours_start: 22, quiet_hours_end: 7 },
    category: 'system',
    now,
  });
  expect(d.delayMs).toBeGreaterThan(0);
});

it('midnight wrap: hour 01 is inside start=22 end=7', () => {
  const now = new Date('2026-07-01T01:00:00Z');
  const d = decideChannels({
    prefs: { ...base, quiet_hours_start: 22, quiet_hours_end: 7 },
    category: 'system',
    now,
  });
  expect(d.delayMs).toBeGreaterThan(0);
});

// ── No quiet config → delayMs 0 ───────────────────────────────────────────────

it('no quiet config → delayMs 0', () => {
  const d = decideChannels({
    prefs: { ...base },
    category: 'system',
    now: new Date(),
  });
  expect(d.delayMs).toBe(0);
});

it('only quiet_hours_start set (no end) → delayMs 0', () => {
  const d = decideChannels({
    prefs: { ...base, quiet_hours_start: 22 },
    category: 'system',
    now: new Date(),
  });
  expect(d.delayMs).toBe(0);
});

// ── SMS is opt-IN (default off) ───────────────────────────────────────────────

it('sms is false by default (opt-in)', () => {
  const d = decideChannels({
    prefs: { ...base },
    category: 'system',
    now: new Date(),
  });
  expect(d.sms).toBe(false);
});

it('sms is true when sms_enabled and category on', () => {
  const d = decideChannels({
    prefs: { ...base, sms_enabled: true },
    category: 'billing',
    now: new Date(),
  });
  expect(d.sms).toBe(true);
});

it('sms is muted when the category is opted out', () => {
  const d = decideChannels({
    prefs: { ...base, sms_enabled: true, categories: { billing: false } },
    category: 'billing',
    now: new Date(),
  });
  expect(d.sms).toBe(false);
  expect(d.inApp).toBe(true);
});

it('sms respects quiet hours (delayed, not dropped)', () => {
  const now = new Date('2026-07-01T23:00:00Z');
  const d = decideChannels({
    prefs: {
      ...base,
      sms_enabled: true,
      quiet_hours_start: 22,
      quiet_hours_end: 7,
      timezone: null,
    },
    category: 'system',
    now,
  });
  expect(d.sms).toBe(true);
  expect(d.delayMs).toBeGreaterThan(0);
});

// ── Fractional-offset timezone: minute-of-hour read in the SAME tz ────────────

it('accounts for a fractional (+5:30) tz in the quiet-hours delay', () => {
  // 17:00 UTC = 22:30 in Asia/Kolkata (+5:30). Quiet 22:00–07:00 IST → in window.
  const now = new Date('2026-07-01T17:00:00Z');
  const d = decideChannels({
    prefs: {
      ...base,
      quiet_hours_start: 22,
      quiet_hours_end: 7,
      timezone: 'Asia/Kolkata',
    },
    category: 'system',
    now,
  });
  expect(d.email).toBe(true);
  // 9h until 07:00 minus the 30 min already elapsed in IST → 8h30m.
  expect(d.delayMs).toBe(9 * 3_600_000 - 30 * 60_000);
});

// ── Bad timezone must not throw ───────────────────────────────────────────────

it('bad timezone falls back to UTC hour and does not throw', () => {
  const now = new Date('2026-07-01T23:00:00Z');
  expect(() =>
    decideChannels({
      prefs: {
        ...base,
        quiet_hours_start: 22,
        quiet_hours_end: 7,
        timezone: 'Not/AReal_Zone',
      },
      category: 'system',
      now,
    }),
  ).not.toThrow();
});

// ── delayMs precision ─────────────────────────────────────────────────────────

it('delayMs is positive integer (not negative)', () => {
  const now = new Date('2026-07-01T23:30:00Z');
  const d = decideChannels({
    prefs: { ...base, quiet_hours_start: 22, quiet_hours_end: 7 },
    category: 'system',
    now,
  });
  expect(d.delayMs).toBeGreaterThan(0);
  expect(Number.isFinite(d.delayMs)).toBe(true);
});
