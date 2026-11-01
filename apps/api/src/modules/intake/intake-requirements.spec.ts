import {
  intakeFactSpecs,
  isIntakeAnswered,
  missingIntakeFacts,
  plannedStay,
  stayDaysInclusive,
  formatLongDate,
} from '@visaai/types';

const TRV = {
  country: 'CA',
  visaaiId: 'ca-visitor-visa-temporary-resident-visa',
};

/** The base answers every route needs. */
const BASE_ANSWERS = {
  purpose_of_visit: 'family visit',
  employed: false,
  planned_entry_date: '2027-03-01',
  planned_departure_date: '2027-04-30',
};

/** Everything IMM 5257 asks that the generic interview did not. */
const IRCC_ANSWERS = {
  ...BASE_ANSWERS,
  passport_type: 'Regular',
  us_permanent_resident: false,
  has_valid_us_visa: false,
  previously_visited_canada: 'No',
  uses_representative: false,
};

describe('stay dates', () => {
  it('counts both the arrival and the departure day', () => {
    expect(stayDaysInclusive('2027-03-01', '2027-04-30')).toBe(61);
    expect(stayDaysInclusive('2027-03-01', '2027-03-01')).toBe(1);
  });

  it('refuses unreadable or reversed dates rather than guessing', () => {
    expect(stayDaysInclusive('March 2027', '2027-04-30')).toBeNull();
    expect(stayDaysInclusive('2027-04-30', '2027-03-01')).toBeNull();
    expect(stayDaysInclusive('2027-02-30', '2027-03-05')).toBeNull();
  });

  it('reads whichever date keys the interview used, ignoring a stale day count', () => {
    expect(
      plannedStay({
        intended_arrival_date: '2027-03-01',
        intended_departure_date: '2027-04-30',
        duration_of_stay_days: 56,
      }),
    ).toEqual({
      entryDate: '2027-03-01',
      departureDate: '2027-04-30',
      days: 61,
    });
  });

  it('formats a long date the way IRCC officers read it', () => {
    expect(formatLongDate('2027-03-01')).toBe('March 1, 2027');
  });
});

describe('required intake answers', () => {
  it('a route with no configuration asks only the base facts (other countries unchanged)', () => {
    const keys = intakeFactSpecs({
      country: 'GB',
      visaaiId: 'gb-standard-visitor',
    }).map((s) => s.key);
    expect(keys).toEqual([
      'purpose_of_visit',
      'employed',
      'duration_of_stay_days',
    ]);
  });

  it('an applicant who answered only two questions is not done (#2)', () => {
    const missing = missingIntakeFacts(
      { purpose_of_visit: 'family visit', employed: false },
      TRV,
    ).map((s) => s.key);
    expect(missing).toContain('duration_of_stay_days');
    expect(missing).toContain('passport_type');
    expect(
      isIntakeAnswered({ purpose_of_visit: 'x', employed: false }, TRV),
    ).toBe(false);
  });

  it('Canada TRV asks passport type, US status, past travel to Canada and representative (#50)', () => {
    const keys = missingIntakeFacts(BASE_ANSWERS, TRV).map((s) => s.key);
    expect(keys).toEqual([
      'passport_type',
      'us_permanent_resident',
      'has_valid_us_visa',
      'previously_visited_canada',
      'uses_representative',
    ]);
  });

  it('a "no" is an answer', () => {
    expect(isIntakeAnswered(IRCC_ANSWERS, TRV)).toBe(true);
  });

  it('representative details are required only once a representative is used', () => {
    const withRep = { ...IRCC_ANSWERS, uses_representative: 'yes' };
    expect(missingIntakeFacts(withRep, TRV).map((s) => s.key)).toEqual([
      'representative_name',
      'representative_paid',
      'representative_contact',
      'representative_address',
    ]);
    expect(
      isIntakeAnswered(
        {
          ...withRep,
          representative_name: 'Jane Doe',
          representative_paid: 'unpaid',
          representative_email: 'jane@example.com',
          representative_address: '1 Main St, Toronto',
        },
        TRV,
      ),
    ).toBe(true);
  });

  it('accepts facts recorded under an alias key', () => {
    expect(
      isIntakeAnswered(
        {
          purpose: 'tourism',
          employment_status: 'retired',
          intended_arrival_date: '2027-03-01',
          intended_departure_date: '2027-04-30',
          passport_type: 'Regular',
          has_us_green_card: false,
          us_visa: 'no',
          visited_canada_before: false,
          has_representative: false,
        },
        TRV,
      ),
    ).toBe(true);
  });

  it('a stored day count alone still satisfies routes that do not need dates', () => {
    expect(
      isIntakeAnswered(
        { purpose_of_visit: 'work', employed: true, duration_of_stay_days: 30 },
        { country: 'US' },
      ),
    ).toBe(true);
  });
});
