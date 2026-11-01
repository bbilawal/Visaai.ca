import { reminderKindFor } from '../src/modules/reminders/cadence';

describe('reminderKindFor', () => {
  it('returns null below 3 days', () => {
    expect(reminderKindFor(0)).toBeNull();
    expect(reminderKindFor(2)).toBeNull();
  });
  it('returns stall_3 at 3-6 days', () => {
    expect(reminderKindFor(3)).toBe('stall_3');
    expect(reminderKindFor(6)).toBe('stall_3');
  });
  it('returns stall_7 at 7-13 days', () => {
    expect(reminderKindFor(7)).toBe('stall_7');
    expect(reminderKindFor(13)).toBe('stall_7');
  });
  it('returns stall_14 at 14+ days', () => {
    expect(reminderKindFor(14)).toBe('stall_14');
    expect(reminderKindFor(40)).toBe('stall_14');
  });
});
