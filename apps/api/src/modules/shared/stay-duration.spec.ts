import {
  stayFromDates,
  withStayFromDates,
  DURATION_KEY,
} from './stay-duration';

/**
 * 2026-10-14 dry run: the cover letter said 56 days (the intake's stated
 * duration_of_stay_days) while the LOE said 62 (the model counted the dates).
 * The planned dates are the fact; the stated number is a guess.
 */
describe('stayFromDates — one counting convention (inclusive days)', () => {
  it('counts 2026-12-01 → 2027-01-31 as 62 days, 61 nights', () => {
    expect(
      stayFromDates({
        planned_entry_date: '2026-12-01',
        planned_departure_date: '2027-01-31',
      }),
    ).toEqual({
      entryDate: '2026-12-01',
      departureDate: '2027-01-31',
      days: 62,
      nights: 61,
    });
  });

  it('a same-day trip is 1 day', () => {
    expect(
      stayFromDates({
        arrival_date: '2026-12-01',
        departure_date: '2026-12-01',
      })?.days,
    ).toBe(1);
  });

  it('accepts intended_* keys and an ISO timestamp', () => {
    expect(
      stayFromDates({
        intended_arrival_date: '2026-12-01T00:00:00Z',
        intended_departure_date: '2026-12-10',
      })?.days,
    ).toBe(10);
  });

  it('returns null without both dates, with a reversed range, or with junk', () => {
    expect(stayFromDates({ planned_entry_date: '2026-12-01' })).toBeNull();
    expect(
      stayFromDates({
        planned_entry_date: '2026-12-10',
        planned_departure_date: '2026-12-01',
      }),
    ).toBeNull();
    expect(
      stayFromDates({
        planned_entry_date: 'soon',
        planned_departure_date: '2026-12-01',
      }),
    ).toBeNull();
    expect(
      stayFromDates({
        planned_entry_date: '2026-02-30',
        planned_departure_date: '2026-03-01',
      }),
    ).toBeNull();
  });

  it('ignores visa / passport validity dates', () => {
    expect(
      stayFromDates({
        passport_expiry_date: '2030-01-01',
        visa_entry_date: '2020-01-01',
        planned_entry_date: '2026-12-01',
        planned_departure_date: '2026-12-02',
      })?.days,
    ).toBe(2);
  });
});

describe('withStayFromDates — dates win over a stated duration', () => {
  it('overwrites every stated duration key with the date-derived days', () => {
    const out = withStayFromDates({
      planned_entry_date: '2026-12-01',
      planned_departure_date: '2027-01-31',
      duration_of_stay_days: 56,
      length_of_stay: '8 weeks',
      name: 'A',
    });
    expect(out.profile.duration_of_stay_days).toBe(62);
    expect(out.profile.length_of_stay).toBe(62);
    expect(out.profile.name).toBe('A');
    expect(out.stay?.days).toBe(62);
  });

  it('adds duration_of_stay_days when the profile had none', () => {
    const out = withStayFromDates({
      planned_entry_date: '2026-12-01',
      planned_departure_date: '2026-12-05',
    });
    expect(out.profile.duration_of_stay_days).toBe(5);
  });

  it('leaves the profile untouched (same object values) without dates', () => {
    const profile = { duration_of_stay_days: 56 };
    const out = withStayFromDates(profile);
    expect(out.stay).toBeNull();
    expect(out.profile).toEqual({ duration_of_stay_days: 56 });
  });

  it('DURATION_KEY matches the duration spellings and not the dates', () => {
    for (const k of [
      'duration_of_stay_days',
      'duration_of_stay',
      'length_of_stay_days',
      'intended_duration_of_stay',
      'stay_duration_days',
    ])
      expect(DURATION_KEY.test(k)).toBe(true);
    expect(DURATION_KEY.test('planned_entry_date')).toBe(false);
  });
});
