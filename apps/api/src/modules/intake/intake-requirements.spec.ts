import {
  intakeFactSpecs,
  isIntakeAnswered,
  missingIntakeFacts,
  plannedStay,
  stayDaysInclusive,
  formatLongDate,
  intakeFactGap,
} from '@visaai/types';
import { IRCC_PORTAL_ANSWERS } from '../../../test/fixtures/ircc-portal-answers';

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
  ...IRCC_PORTAL_ANSWERS,
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
    expect(keys.slice(0, 5)).toEqual([
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
      'representative_relationship',
      'representative_contact',
      'representative_address',
    ]);
    expect(
      isIntakeAnswered(
        {
          ...withRep,
          representative_name: 'Jane Doe',
          representative_paid: 'unpaid',
          representative_relationship: 'friend',
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
          // A retired applicant's work history runs from the retirement.
          retired_since: '2010-01',
          intended_arrival_date: '2027-03-01',
          intended_departure_date: '2027-04-30',
          passport_type: 'Regular',
          has_us_green_card: false,
          us_visa: 'no',
          visited_canada_before: false,
          has_representative: false,
          ...IRCC_PORTAL_ANSWERS,
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

describe('IRCC portal questions (dry run 2026-10-16)', () => {
  const missing = (p: Record<string, unknown>) =>
    missingIntakeFacts({ ...IRCC_ANSWERS, ...p }, TRV).map((s) => s.key);

  it('a fully answered applicant has nothing left', () => {
    expect(missing({})).toEqual([]);
  });

  it('spouse questions only apply to a married applicant', () => {
    const single = { ...IRCC_ANSWERS, marital_status: 'Single' };
    for (const k of [
      'spouse_date_of_birth',
      'spouse_country_of_birth',
      'spouse_occupation',
      'spouse_same_address',
      'spouse_coming_to_canada',
    ])
      delete (single as Record<string, unknown>)[k];
    expect(missingIntakeFacts(single, TRV)).toEqual([]);
  });

  it('children questions are asked per family, and skipped without children', () => {
    const kids = {
      has_children: undefined,
      // A complete child (children asks name, date of birth, son or daughter).
      children: [{ name: 'Ali Khan', relationship: 'son', birth_year: 1995 }],
    };
    expect(missing(kids)).toEqual([
      'children_deceased',
      'children_living_with_you',
      'children_accompanying',
      'children_countries_of_birth',
    ]);
    expect(
      missing({
        ...kids,
        children_living_with_you: ['Ali Khan'],
        children_accompanying: 'none',
        children_countries_of_birth: 'Pakistan',
        children_deceased: 'none',
      }),
    ).toEqual([]);
  });

  it('asks about refusals, and for the details only after a yes (live E2E 2026-10-18)', () => {
    expect(missing({ refused_or_ordered_to_leave: undefined })).toEqual([
      'refused_or_ordered_to_leave',
    ]);
    expect(missing({ refused_or_ordered_to_leave: true })).toEqual([
      'refusal_details',
    ]);
    expect(
      missing({
        refused_or_ordered_to_leave: true,
        refusal_details: 'Canada, visitor visa, October 2023',
      }),
    ).toEqual([]);
    // Also asked on the business visitor and super visa routes.
    for (const visaaiId of ['ca-business-visitors', 'ca-super-visa'])
      expect(
        intakeFactSpecs({ country: 'CA', visaaiId }).map((s) => s.key),
      ).toContain('refused_or_ordered_to_leave');
  });

  it('the retirement date is asked only of a retired applicant', () => {
    expect(missing({ retired: true })).toEqual(['retirement_date']);
    expect(missing({ retired: true, retirement_date: '2016-10' })).toEqual([]);
  });

  it('host questions only when visiting family in Canada', () => {
    expect(missing({ family_in_destination: true })).toEqual([
      'inviter_phone',
      'inviter_phone_type',
      'inviter_email',
      'has_second_inviter',
    ]);
  });

  it('documents and aggregate answers satisfy what they cover, never more', () => {
    const p = { ...IRCC_ANSWERS } as Record<string, unknown>;
    delete p.country_of_birth;
    delete p.ever_charged;
    delete p.ever_convicted;
    delete p.ever_arrested;
    p.place_of_birth = 'Rawalpindi, Pakistan';
    p.criminal_charges_or_convictions = false;
    // charged / convicted are covered; arrested is not.
    expect(missingIntakeFacts(p, TRV).map((s) => s.key)).toEqual([
      'ever_arrested',
    ]);
  });
});

describe('IRCC applicant address, sex and current job (live E2E 2026-10-18)', () => {
  const VISITOR_ROUTES = [
    'ca-visitor-visa-temporary-resident-visa',
    'ca-business-visitors',
    'ca-super-visa',
  ];
  const JOB_KEYS = [
    'job_title',
    'employer_name',
    'job_duties',
    'employment_start_date',
    'employer_address',
  ];
  const missing = (p: Record<string, unknown>) =>
    missingIntakeFacts({ ...IRCC_ANSWERS, ...p }, TRV).map((s) => s.key);

  it('is asked on all three visitor routes, and the eTA is unchanged', () => {
    for (const visaaiId of VISITOR_ROUTES) {
      const keys = intakeFactSpecs({ country: 'CA', visaaiId }).map((s) => s.key);
      for (const k of ['residential_address', 'sex', ...JOB_KEYS])
        expect(keys).toContain(k);
    }
    const eta = intakeFactSpecs({ country: 'CA', visaaiId: 'ca-electronic-travel-authorization-eta' });
    const etaKeys = eta.map((s) => s.key);
    for (const k of ['job_duties', 'employment_start_date', 'employer_address'])
      expect(etaKeys).not.toContain(k);
    // The eTA keeps its own wording.
    expect(eta.find((s) => s.key === 'sex')?.question).toBe(
      'What sex is shown on your passport?',
    );
  });

  it('asks the home address unless its parts are already recorded', () => {
    expect(missing({ residential_address: undefined })).toEqual([
      'residential_address',
    ]);
    expect(
      missing({ residential_address: undefined, home_address: '12 Mall Rd, Lahore' }),
    ).toEqual([]);
    expect(
      missing({
        residential_address: undefined,
        residential_address_street: '12 Mall Road',
        residential_address_city: 'Lahore',
      }),
    ).toEqual([]);
  });

  it('asks sex only when the passport scan did not give it', () => {
    expect(missing({ sex: undefined })).toEqual(['sex']);
    expect(missing({ sex: undefined, gender: 'F' })).toEqual([]);
  });

  it('a student recorded only as an occupation is not asked for a job (review)', () => {
    for (const k of JOB_KEYS) expect(missing({ occupation: 'Student' })).not.toContain(k);
  });

  it('asks the current job only of someone who has one', () => {
    expect(missing({ employed: true })).toEqual(JOB_KEYS);
    // A specific occupation already answers the job title; a bare category does not.
    expect(missing({ employed: true, occupation: 'Software engineer' })).toEqual(
      JOB_KEYS.slice(1),
    );
    expect(missing({ employed: 'self-employed', occupation: 'self-employed' })).toEqual(
      JOB_KEYS,
    );
    expect(
      missing({
        employed: true,
        job_title: 'Owner of a textile shop',
        employer_name: 'Ahmed Textiles',
        job_duties: 'Runs the shop',
        employment_start_date: '2012-04',
        employer_address: '5 Anarkali Bazaar, Lahore, Pakistan',
      }),
    ).toEqual([]);
    for (const p of [
      { employed: false },
      { retired: true, retirement_date: '2016-10' },
      { employed: true, occupation: 'Homemaker' },
      { employment_status: 'student' },
      { is_student: true },
    ])
      expect(missing(p)).toEqual([]);
  });
});

describe('IRCC travel, biometrics, marriage, children and work history (live E2E 2026-10-19)', () => {
  const missing = (p: Record<string, unknown>) =>
    missingIntakeFacts({ ...IRCC_ANSWERS, ...p }, TRV).map((s) => s.key);
  const NEW_KEYS = [
    'marriage_date',
    'children_countries_of_birth',
    'work_history',
    'travelled_last_5_years',
    'travel_history',
    'held_canadian_visa_10_years',
    'travel_by_air',
    'biometrics_given',
    'biometrics_enrollment_date',
  ];
  const yearsAgo = (n: number) => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - n);
    return d.toISOString().slice(0, 7);
  };

  it('is asked on all three visitor routes, under the keys the portal reads, and not on the eTA', () => {
    for (const visaaiId of [
      'ca-visitor-visa-temporary-resident-visa',
      'ca-business-visitors',
      'ca-super-visa',
    ]) {
      const keys = intakeFactSpecs({ country: 'CA', visaaiId }).map((s) => s.key);
      for (const k of NEW_KEYS) expect(keys).toContain(k);
    }
    const eta = intakeFactSpecs({
      country: 'CA',
      visaaiId: 'ca-electronic-travel-authorization-eta',
    }).map((s) => s.key);
    for (const k of ['marriage_date', 'work_history', 'travel_history', 'biometrics_given'])
      expect(eta).not.toContain(k);
  });

  it('asks whether they travelled, then each trip only after a yes', () => {
    expect(missing({ travelled_last_5_years: undefined })).toEqual([
      'travelled_last_5_years',
    ]);
    expect(missing({ travelled_last_5_years: true })).toEqual(['travel_history']);
    expect(
      missing({
        travelled_last_5_years: true,
        travel_history: [
          { country: 'UAE', city: 'Dubai', from: '2023-01', to: '2023-02', purpose: 'Tourism' },
        ],
      }),
    ).toEqual([]);
    // A recorded trip list (even empty) answers the yes/no.
    expect(missing({ travelled_last_5_years: undefined, travel_history: [] })).toEqual([]);
    expect(missing({ travelled_last_5_years: undefined, has_travel_history: 'No' })).toEqual([]);
  });

  it('asks the date of marriage only of a married or common-law applicant', () => {
    expect(missing({ marriage_date: undefined })).toEqual(['marriage_date']);
    expect(missing({ marriage_date: undefined, date_of_marriage: '1990-05-12' })).toEqual([]);
    expect(
      missing({ marriage_date: undefined, marital_status: 'Common-law', common_law_since: '2015-01-01' }),
    ).toEqual([]);
    const single = { ...IRCC_ANSWERS, marital_status: 'Single' } as Record<string, unknown>;
    delete single.marriage_date;
    expect(missingIntakeFacts(single, TRV).map((s) => s.key)).not.toContain('marriage_date');
  });

  it("asks each child's country of birth only when there are children who lack it", () => {
    const kids = {
      has_children: undefined,
      // A complete child (children asks name, date of birth, son or daughter).
      children: [{ name: 'Ali Khan', relationship: 'son', birth_year: 1995 }],
      children_living_with_you: ['Ali Khan'],
      children_accompanying: [],
      children_deceased: [],
    };
    expect(missing(kids)).toEqual(['children_countries_of_birth']);
    expect(missing({ ...kids, children_countries_of_birth: 'Ali Khan: Pakistan' })).toEqual([]);
    expect(
      missing({
        ...kids,
        children: [{ name: 'Ali Khan', relationship: 'son', birth_year: 1995, country_of_birth: 'Pakistan' }],
      }),
    ).toEqual([]);
    expect(missing({ has_children: false })).toEqual([]);
  });

  it('biometrics: asks whether given, then when — the date decides re-use', () => {
    expect(missing({ biometrics_given: undefined })).toEqual(['biometrics_given']);
    expect(missing({ biometrics_given: true })).toEqual(['biometrics_enrollment_date']);
    expect(missing({ biometrics_given: true, biometrics_enrollment_date: '2019-03' })).toEqual([]);
    expect(missing({ biometrics_given: undefined, biometrics_date: '2019-03-01' })).toEqual([]);
    // Given more than 10 years ago: not an answer to "in the past 10 years".
    expect(missing({ biometrics_given: undefined, biometrics_date: '2012-03-01' })).toEqual([
      'biometrics_given',
    ]);
  });

  it('asks about a Canadian visa in the past 10 years and travel by air', () => {
    expect(missing({ held_canadian_visa_10_years: undefined })).toEqual([
      'held_canadian_visa_10_years',
    ]);
    expect(
      missing({ held_canadian_visa_10_years: undefined, canadian_visa_last_10y: false }),
    ).toEqual([]);
    expect(missing({ travel_by_air: undefined })).toEqual(['travel_by_air']);
    expect(missing({ travel_by_air: undefined, travelling_by_air: 'Yes' })).toEqual([]);
    expect(missing({ travel_by_air: undefined, travel_mode: 'flight' })).toEqual([]);
  });

  it('asks for earlier jobs only when the current activity began less than 10 years ago', () => {
    const job = {
      employed: true,
      job_title: 'Teacher',
      employer_name: 'City School',
      job_duties: 'Teaches',
      employer_address: '1 Main Rd, Lahore, Pakistan',
    };
    expect(missing({ ...job, employment_start_date: yearsAgo(3) })).toEqual(['work_history']);
    expect(missing({ ...job, employment_start_date: yearsAgo(12) })).toEqual([]);
    expect(
      missing({
        ...job,
        employment_start_date: yearsAgo(3),
        work_history: [
          { from: yearsAgo(11), to: yearsAgo(3), activity: 'Clerk', employer: 'Bank', duties: 'Counter service', address: '5 Mall Road', city: 'Lahore', country: 'Pakistan' },
        ],
      }),
    ).toEqual([]);
    // A recent retirement needs the years before it.
    expect(missing({ retired: true, retirement_date: yearsAgo(2) })).toEqual(['work_history']);
    // Start unknown: the start question comes first.
    expect(missing({ ...job })).toEqual(['employment_start_date']);
    // The current activity's own start counts: a recent retirement after a
    // long job still needs the years before it.
    expect(
      missing({ retired: true, retirement_date: yearsAgo(2), employment_start_date: yearsAgo(30) }),
    ).toEqual(['work_history']);
    // Not working, since when unknown: asked here.
    expect(missing({ employed: false, not_employed_since: undefined })).toEqual(['work_history']);
    expect(missing({ employed: false, not_employed_since: yearsAgo(4) })).toEqual(['work_history']);
    expect(missing({ employed: false, not_employed_since: yearsAgo(11) })).toEqual([]);
  });
});

describe('earlier work periods must be complete (live E2E 2026-10-19)', () => {
  const NOW = { employed: true, employment_start_date: '2025-06' };
  const missing = (p: Record<string, unknown>) =>
    missingIntakeFacts({ ...IRCC_ANSWERS, ...NOW, ...p }, TRV).map((s) => s.key);
  const spec = () =>
    intakeFactSpecs(TRV).find((s) => s.key === 'work_history')!;

  it('re-asks a period recorded without a street address or duties', () => {
    const p = {
      work_history: [
        { from: '2016-06', to: '2016-09', activity: 'unemployed', city: 'Gujrat', country: 'Pakistan' },
        {
          from: '2016-10',
          to: '2025-05',
          activity: 'ran own business',
          employer: 'Acme Blocks (Private) Limited',
          city: 'Gujrat',
          country: 'Pakistan',
        },
      ],
    };
    expect(missing(p)).toContain('work_history');
    expect(intakeFactGap({ ...NOW, ...p }, spec())).toBe(
      '2016-06 to 2016-09 (unemployed): street address; 2016-10 to 2025-05 (ran own business): street address, main duties',
    );
  });

  it('a complete record is answered; a period without work needs no employer', () => {
    expect(
      missing({
        work_history: [
          { from: '2016-06', to: '2016-09', activity: 'unemployed', address: '12 Mall Road', city: 'Gujrat', country: 'Pakistan' },
          {
            from: '2016-10',
            to: '2025-05',
            activity: 'owner of a concrete block factory',
            employer: 'Acme Blocks',
            duties: 'Ran production and sales',
            address: { street: 'GT Road', city: 'Gujrat', country: 'Pakistan' },
          },
        ],
      }),
    ).not.toContain('work_history');
  });

  it('does not check the current period or studies, and current-only coverage still satisfies', () => {
    expect(
      missing({
        work_history: [
          { from: '2014-01', to: '2018-06', activity: 'student', city: 'Lahore' },
          { from: '2018-07', to: 'present', activity: 'Clerk' },
        ],
      }),
    ).not.toContain('work_history');
    // Current job alone covers 10 years: old periods are not needed.
    expect(
      missing({
        employment_start_date: '2010-01',
        work_history: [{ from: '2008-01', to: '2009-12', activity: 'Clerk' }],
      }),
    ).not.toContain('work_history');
  });

  it('matches what the portal can write: a bare street line needs the city; "unknown" is not re-asked', () => {
    const row = (e: Record<string, unknown>) =>
      intakeFactGap(
        { ...NOW, work_history: [{ from: '2016-06', to: '2016-09', activity: 'unemployed', ...e }] },
        spec(),
      );
    expect(row({ address: '5 Mall Road', country: 'Pakistan' })).toContain('city');
    expect(row({ address: '5 Mall Road, Gujrat, Pakistan' })).toBeUndefined();
    // Two parts is a street with commas, not "street, city, country".
    expect(row({ address: 'House 12, Street 4', country: 'Pakistan' })).toContain('city');
    expect(row({ address: { street: 'GT Road' }, city: 'Gujrat', country: 'Pakistan' })).toContain('city');
    expect(row({ address: 'unknown', city: 'Gujrat', country: 'Pakistan' })).toBeUndefined();
    // A year alone, or "unknown", is not asked again; nor an unknown street in an address object.
    expect(row({ address: 'x, y, z', from: '2016' })).toBeUndefined();
    expect(row({ address: 'x, y, z', from: 'unknown' })).toBeUndefined();
    expect(row({ address: 'x, y, z', from: 'June' })).toContain('start month and year');
    expect(row({ address: { street: 'unknown', city: 'Gujrat' }, country: 'Pakistan' })).toBeUndefined();
  });
});


describe('IRCC money for the trip and the inviter address (live E2E 2026-10-19)', () => {
  const BIZ = { country: 'CA', visaaiId: 'ca-business-visitors' };
  const missing = (p: Record<string, unknown>, route = TRV) =>
    missingIntakeFacts({ ...IRCC_ANSWERS, ...p }, route).map((s) => s.key);

  it('asks the money available for the trip in Canadian dollars', () => {
    expect(missing({ available_funds_cad: undefined })).toContain('available_funds_cad');
    // A balance in rupees does not answer it; one in CAD does.
    expect(
      missing({ available_funds_cad: undefined, available_funds: 900000, funds_currency: 'PKR' }),
    ).toContain('available_funds_cad');
    expect(
      missing({ available_funds_cad: undefined, available_funds: 6000, funds_currency: 'CAD' }),
    ).not.toContain('available_funds_cad');
  });

  it('re-asks an inviter address without a street number or postal code', () => {
    const spec = intakeFactSpecs(BIZ).find((s) => s.key === 'inviter_address')!;
    expect(intakeFactGap({ inviter_address: 'Toronto, Canada' }, spec)).toBe(
      'the address has no street number and street name and no postal code',
    );
    expect(intakeFactGap({ inviter_address: '100 King St W, Toronto, ON M5X 1A9' }, spec)).toBeUndefined();
    expect(intakeFactGap({ inviter_address: 'Toronto — street unknown' }, spec)).toBeUndefined();
  });
});

describe('inviter address gaps (review)', () => {
  const spec = () =>
    intakeFactSpecs({ country: 'CA', visaaiId: 'ca-business-visitors' }).find((s) => s.key === 'inviter_address')!;
  it('an address object with a numeric street number is complete', () => {
    expect(
      intakeFactGap(
        { inviter_address: { street_number: 100, street_name: 'King St W', city: 'Toronto', postal_code: 'M5X 1A9' } },
        spec(),
      ),
    ).toBeUndefined();
  });
  it('an alias is checked when the canonical key is blank', () => {
    expect(intakeFactGap({ inviter_address: '', company_address: 'Toronto, Canada' }, spec())).toContain('postal code');
  });
});
