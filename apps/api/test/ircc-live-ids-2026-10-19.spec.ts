/**
 * Fields PRs #234-#239 left as notes because their ids had not been read off
 * the live portal. Recorded live 2026-10-19 (draft, nothing saved): the U.S.
 * visa's other passport, the multiple-citizenship table, the education and
 * military-service dialogs, and the eTA time zone. Each is checked on its
 * Yes branch, its No branch, and an incomplete answer (blank + note).
 */
import '../src/modules/automation/portal-fills/canada-ircc'; // registers 'ircc'
import '../src/modules/automation/portal-fills/canada-ircc-eta'; // registers 'ircc-eta'
import {
  CA_ETA_VISAAI_ID,
  intakeFactGap,
  intakeFactSpecs,
  missingIntakeFacts,
} from '@visaai/types';
import {
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import { resolvePortalFill } from '../src/strategies/portal-integration/portal-fill.registry';
import {
  educationFieldOption,
  educationLevelOption,
} from '../src/modules/automation/portal-fills/canada-ircc';
import {
  ETA_TIME_ZONES,
  etaTimeZoneOption,
} from '../src/modules/automation/portal-fills/eta-timezones';

const ircc = () => resolvePortalFill('ircc')!;
const TRV = {
  country: 'CA',
  visaaiId: 'ca-visitor-visa-temporary-resident-visa',
};
const SUPER = { country: 'CA', visaaiId: 'ca-super-visa' };
const BUSINESS = { country: 'CA', visaaiId: 'ca-business-visitors' };
const ETA = { country: 'CA', visaaiId: CA_ETA_VISAAI_ID };
const EE = { country: 'CA', visaaiId: 'ca-express-entry' };

const BASE: Record<string, unknown> = {
  given_name: 'Muzaffar',
  family_name: 'Ahmad',
  date_of_birth: '1958-03-09',
  nationality: 'PAK',
  passport_number: 'AB1234567',
  place_of_birth: 'Rawalpindi, Pakistan',
  residential_address:
    'House 12, Street 5, Sector F-7, Islamabad 44000, Pakistan',
  purpose_of_visit: 'family visit',
  planned_entry_date: '2027-03-01',
  planned_departure_date: '2027-04-30',
};

const inputs = (p: Record<string, unknown>) =>
  buildMappingInputs(ircc(), { ...BASE, ...p });
/** target → value of every write on one page. */
const writes = (p: Record<string, unknown>, page: string) =>
  inputs(p)
    .filter((m) => m.page === page)
    .map((m) => [m.targetField, m.mappedValue] as [string, string]);
const has = (p: Record<string, unknown>, page: string, target: string) =>
  writes(p, page).some(([t]) => t === target);
const left = (p: Record<string, unknown>, page: string) =>
  portalFillCoverage(ircc(), { ...BASE, ...p }).pages.find(
    (x) => x.page === page,
  )?.left ?? [];
const note = (p: Record<string, unknown>, page: string, label: string) =>
  left(p, page).find((n) => n.label === label);
const asked = (p: Record<string, unknown>, ctx = TRV) =>
  missingIntakeFacts({ ...BASE, ...p }, ctx).map((f) => f.key);
const keys = (ctx: { country: string; visaaiId: string }) =>
  intakeFactSpecs(ctx).map((s) => s.key);

// ── 1. U.S. visa in another passport ────────────────────────────────────────
describe('/bio-data-travel-docs: U.S. visa in a different passport', () => {
  const DOC = '/bio-data-travel-docs';
  const YES = '#passportOtherThanUS_radio-button-01-input';
  const NO = '#passportOtherThanUS_radio-button-02-input';
  const US = {
    has_valid_us_visa: true,
    us_nonimmigrant_visa_number: 'A1234567',
    us_nonimmigrant_visa_expiry_date: '2030-06-15',
  };
  const OLD = {
    us_visa_in_other_passport: true,
    us_visa_passport_country: 'Pakistan',
    us_visa_passport_number: 'AA7654321',
    us_visa_passport_issue_date: '2015-02-03',
    us_visa_passport_expiry_date: '2025-02-02',
  };

  it('Yes with the old passport known: Yes, then its country, number twice and both dates', () => {
    const w = writes({ ...US, ...OLD }, DOC);
    expect(w).toEqual(
      expect.arrayContaining([
        ['#docNumberVisa_input', 'A1234567'],
        ['#dateVisaExpiryYear_sltDateYear', '2030'],
        [YES, 'Yes'],
        // The same IRCC country code as #codePassport_select.
        [
          '#codePassportUS_select',
          w.find(([t]) => t === '#codePassport_select')![1],
        ],
        ['#travelDocNumUS_input', 'AA7654321'],
        ['#travelDocNumConfirmationUS_input', 'AA7654321'],
        ['#dateIssuePassportUSYear_sltDateYear', '2015'],
        ['#dateIssuePassportUSMonth_sltDateMonth', '02'],
        ['#dateIssuePassportUSDay_sltDateDay', '3'],
        ['#dateExpiryPassportUSYear_sltDateYear', '2025'],
        ['#dateExpiryPassportUSMonth_sltDateMonth', '02'],
        ['#dateExpiryPassportUSDay_sltDateDay', '2'],
      ]),
    );
    expect(
      note({ ...US, ...OLD }, DOC, 'U.S. visa in another passport'),
    ).toBeUndefined();
  });

  it('No: No is written, nothing it would reveal, no note', () => {
    const p = { ...US, ...OLD, us_visa_in_other_passport: false };
    expect(writes(p, DOC)).toContainEqual([NO, 'No']);
    expect(has(p, DOC, '#codePassportUS_select')).toBe(false);
    expect(has(p, DOC, '#travelDocNumUS_input')).toBe(false);
    expect(note(p, DOC, 'U.S. visa in another passport')).toBeUndefined();
  });

  it('Yes with the old passport incomplete: question left blank, with a note', () => {
    const p = { ...US, ...OLD, us_visa_passport_issue_date: undefined };
    expect(has(p, DOC, YES)).toBe(false);
    expect(has(p, DOC, '#travelDocNumUS_input')).toBe(false);
    expect(note(p, DOC, 'U.S. visa in another passport')).toMatchObject({
      reason: 'not_in_profile',
      note: expect.stringMatching(/issue date/),
    });
  });

  it('not answered: left with a note; no U.S. visa: neither', () => {
    expect(has(US, DOC, YES) || has(US, DOC, NO)).toBe(false);
    expect(note(US, DOC, 'U.S. visa in another passport')?.reason).toBe(
      'fill_yourself',
    );
    const none = { has_valid_us_visa: false, ...OLD };
    expect(has(none, DOC, YES)).toBe(false);
    expect(note(none, DOC, 'U.S. visa in another passport')).toBeUndefined();
  });

  it('the interview asks it after a U.S. visa Yes, and the old passport after its Yes — tr-rt routes only', () => {
    expect(asked(US)).toContain('us_visa_in_other_passport');
    expect(asked({ has_valid_us_visa: false })).not.toContain(
      'us_visa_in_other_passport',
    );
    expect(asked({ ...US, us_visa_in_other_passport: true })).toEqual(
      expect.arrayContaining([
        'us_visa_passport_country',
        'us_visa_passport_number',
        'us_visa_passport_issue_date',
        'us_visa_passport_expiry_date',
      ]),
    );
    expect(asked({ ...US, us_visa_in_other_passport: false })).not.toContain(
      'us_visa_passport_number',
    );
    expect(asked({ ...US, us_visa_in_other_passport: true }, SUPER)).toContain(
      'us_visa_passport_country',
    );
    expect(
      asked({ ...US, us_visa_in_other_passport: true }, BUSINESS),
    ).toContain('us_visa_passport_country');
    for (const ctx of [ETA, EE])
      expect(keys(ctx)).not.toContain('us_visa_in_other_passport');
  });
});

// ── 2. More than one citizenship ────────────────────────────────────────────
describe('/nationality: citizen of more than one country', () => {
  const NAT = '/nationality';
  const YES = '#citizenshipOfCountryOrTerritory_radio-button-01-input';
  const NO = '#citizenshipOfCountryOrTerritory_radio-button-02-input';
  const DUAL = {
    multiple_citizenship: true,
    citizen_from_birth: true,
    other_citizenships: [
      { country: 'United Kingdom', from_birth: false, since: '2005-07-01' },
    ],
  };

  it("Yes with every citizenship complete: a row for each, the passport's first", () => {
    const w = writes(DUAL, NAT);
    expect(w).toContainEqual([YES, 'Yes']);
    const adds = w.filter(
      ([t]) => t === '#otherCountriesCitizenship_add_button',
    );
    expect(adds).toHaveLength(2);
    const countries = w
      .filter(([t]) => t === '#countryOfCitizenship_select')
      .map(([, v]) => v);
    expect(countries).toHaveLength(2);
    expect(countries[0]).not.toBe(countries[1]);
    // The primary is since birth (ticked: the dates fill themselves); the
    // other gives the date it was granted.
    expect(w.filter(([t]) => t === '#citizenFromBirth_chk-input')).toHaveLength(
      1,
    );
    expect(w).toEqual(
      expect.arrayContaining([
        ['#citizenFromYear_sltDateYear', '2005'],
        ['#citizenFromMonth_sltDateMonth', '07'],
        ['#citizenFromDay_sltDateDay', '1'],
      ]),
    );
    expect(note(DUAL, NAT, 'Other citizenships')).toBeUndefined();
  });

  it('a naturalised primary gives its own date', () => {
    const p = {
      ...DUAL,
      citizen_from_birth: false,
      citizenship_acquired_date: '1990-01-15',
      other_citizenships: [{ country: 'Canada', from_birth: true }],
    };
    const w = writes(p, NAT);
    expect(w).toContainEqual([YES, 'Yes']);
    expect(w).toContainEqual(['#citizenFromYear_sltDateYear', '1990']);
  });

  it('Yes with a citizenship incomplete: question left blank, the gaps noted', () => {
    const p = { ...DUAL, other_citizenships: ['United Kingdom'] };
    expect(has(p, NAT, YES)).toBe(false);
    expect(has(p, NAT, '#otherCountriesCitizenship_add_button')).toBe(false);
    expect(note(p, NAT, 'Other citizenships')?.note).toMatch(
      /United Kingdom: whether you have been a citizen since birth/,
    );
    const noPrimaryDate = { ...DUAL, citizen_from_birth: false };
    expect(has(noPrimaryDate, NAT, YES)).toBe(false);
    expect(note(noPrimaryDate, NAT, 'Other citizenships')?.note).toMatch(
      /the date you became a citizen/,
    );
  });

  it('No: the single citizenship select, no table, no note', () => {
    const p = { multiple_citizenship: false, citizen_from_birth: true };
    const w = writes(p, NAT);
    expect(w).toContainEqual([NO, 'No']);
    expect(
      w.filter(([t]) => t === '#countryOfCitizenship_select'),
    ).toHaveLength(1);
    expect(has(p, NAT, '#otherCountriesCitizenship_add_button')).toBe(false);
    expect(note(p, NAT, 'Other citizenships')).toBeUndefined();
  });
});

// ── 3. Education ────────────────────────────────────────────────────────────
describe('/activities: post-secondary education rows', () => {
  const ACT = '/activities';
  const YES = '#hasPostSecondaryEducation_radio-button-01-input';
  const SCHOOL = {
    school: 'University of the Punjab',
    street_address: 'Quaid-i-Azam Campus',
    city: 'Lahore',
    country: 'Pakistan',
    from: '1976-09',
    to: '1980-06',
    level: "Bachelor's",
    field_of_study: 'Engineering',
  };

  it.each([
    ["Bachelor's", "University - Bachelor's Deg."],
    ['BSc', "University - Bachelor's Deg."],
    ['MBBS', "University - Bachelor's Deg."],
    ['Master of Science', "University - Master's Deg."],
    ['MBA', "University - Master's Deg."],
    ['PhD', 'University - Doctorate'],
    ['Doctorate', 'University - Doctorate'],
    ['Diploma', 'College - Diploma'],
    ['College - Certificate', 'College - Certificate'],
    ['Postgraduate diploma', undefined],
    ['Graduate', undefined],
    ['FA', undefined],
  ])('level %p → %p', (raw, option) => {
    expect(educationLevelOption(raw)).toBe(option);
  });

  it.each([
    ['Computer Science', 'Computing or Information Technology'],
    ['IT', 'Computing or Information Technology'],
    ['Business Administration', 'Business or Commerce'],
    ['Commerce', 'Business or Commerce'],
    ['MBA', 'Business or Commerce'],
    ['Medicine', 'Medicine'],
    ['MBBS', 'Medicine'],
    ['Law', 'Law'],
    ['Civil Engineering', 'Science, Applied'],
    ['Sciences, Health', 'Sciences, Health'],
    ['Fine arts', undefined],
    ['Pharmacy', undefined],
    ['it was general studies', undefined],
  ])('field %p → %p', (raw, option) => {
    expect(educationFieldOption(raw)).toBe(option);
  });

  it('Yes with a complete school: Yes and the dialog, every field', () => {
    const p = {
      has_post_secondary_education: true,
      education_history: [SCHOOL],
    };
    const w = writes(p, ACT);
    expect(w).toContainEqual([YES, 'Yes']);
    expect(w).toEqual(
      expect.arrayContaining([
        [
          '#educationHistory_add_button',
          expect.stringContaining('University of the Punjab'),
        ],
        ['#nameSchoolEdu_input', 'University of the Punjab'],
        ['#fromEduYear_sltDateYear', '1976'],
        ['#fromEduMonth_sltDateMonth', '09'],
        ['#toEduYear_sltDateYear', '1980'],
        ['#toEduMonth_sltDateMonth', '06'],
        ['#levelStudyEdu_select', "University - Bachelor's Deg."],
        ['#fieldStudyEdu_select', 'Science, Applied'],
        ['#streetAddress_addressEducation', 'Quaid-i-Azam Campus'],
        ['#city_addressEducation', 'Lahore'],
      ]),
    );
    expect(has(p, ACT, '#country_addressEducation')).toBe(true);
    expect(has(p, ACT, '#isOngoingEducation_chk-input')).toBe(false);
    expect(note(p, ACT, 'Education details')).toBeUndefined();
  });

  it('still studying: ongoing ticked, no end date', () => {
    const p = {
      has_post_secondary_education: true,
      education_history: [{ ...SCHOOL, to: 'ongoing' }],
    };
    expect(has(p, ACT, '#isOngoingEducation_chk-input')).toBe(true);
    expect(has(p, ACT, '#toEduYear_sltDateYear')).toBe(false);
  });

  it('Yes with no complete school: blank, the gaps noted (an unclear level is never guessed)', () => {
    const p = {
      has_post_secondary_education: true,
      education_history: [{ ...SCHOOL, level: 'Graduate' }],
    };
    expect(has(p, ACT, YES)).toBe(false);
    expect(has(p, ACT, '#educationHistory_add_button')).toBe(false);
    expect(note(p, ACT, 'Education details')?.note).toMatch(
      /the IRCC level of study for "Graduate"/,
    );
  });

  it('a Canadian school without its street number and street apart is not entered (never split)', () => {
    const p = {
      has_post_secondary_education: true,
      education_history: [{ ...SCHOOL, country: 'Canada', city: 'Toronto' }],
    };
    expect(has(p, ACT, YES)).toBe(false);
    expect(note(p, ACT, 'Education details')?.note).toMatch(
      /street number and street name, each on its own/,
    );
  });

  it('one complete and one incomplete: Yes with the complete row, the other noted', () => {
    const p = {
      has_post_secondary_education: true,
      education_history: [
        SCHOOL,
        { ...SCHOOL, school: 'LUMS', city: undefined },
      ],
    };
    expect(writes(p, ACT)).toContainEqual([YES, 'Yes']);
    expect(
      writes(p, ACT).filter(([t]) => t === '#educationHistory_add_button'),
    ).toHaveLength(1);
    expect(note(p, ACT, 'School 2')?.note).toMatch(/city/);
  });

  it('No is written with no rows', () => {
    const p = {
      has_post_secondary_education: false,
      education_history: [SCHOOL],
    };
    expect(writes(p, ACT)).toContainEqual([
      '#hasPostSecondaryEducation_radio-button-02-input',
      'No',
    ]);
    expect(has(p, ACT, '#educationHistory_add_button')).toBe(false);
  });

  it('the interview asks the street address too', () => {
    const spec = intakeFactSpecs(TRV).find(
      (s) => s.key === 'education_history',
    )!;
    expect(spec.question).toMatch(/street address/);
    expect(
      intakeFactGap(
        {
          has_post_secondary_education: true,
          education_history: [{ ...SCHOOL, street_address: undefined }],
        },
        spec,
      ),
    ).toMatch(/street address/);
    expect(
      intakeFactGap(
        { has_post_secondary_education: true, education_history: [SCHOOL] },
        spec,
      ),
    ).toBeUndefined();
  });
});

// ── 4. Military or police service ───────────────────────────────────────────
describe('/activities: military or police service rows', () => {
  const ACT = '/activities';
  const YES = '#servedArmy_radio-button-01-input';
  const PERIOD = {
    location: 'Kharian Cantonment',
    country: 'Pakistan',
    from: '1978-01',
    to: '1985-12',
    details: 'Pakistan Army, 7th Infantry, Captain, logistics officer',
  };

  it('Yes with a complete period: Yes and the dialog, every field', () => {
    const p = { military_service: true, military_service_history: [PERIOD] };
    const w = writes(p, ACT);
    expect(w).toContainEqual([YES, 'Yes']);
    expect(w).toEqual(
      expect.arrayContaining([
        [
          '#workHistory_add_button',
          expect.stringContaining('Kharian Cantonment'),
        ],
        ['#locationStationed_input', 'Kharian Cantonment'],
        ['#fromServiceYear_sltDateYear', '1978'],
        ['#fromServiceMonth_sltDateMonth', '01'],
        ['#toServiceYear_sltDateYear', '1985'],
        ['#toServiceMonth_sltDateMonth', '12'],
        ['#serviceDetails_txtArea', PERIOD.details],
      ]),
    );
    expect(has(p, ACT, '#countryService_select')).toBe(true);
    expect(note(p, ACT, 'Military or police service details')).toBeUndefined();
  });

  it('still serving: ongoing ticked, no end date', () => {
    const p = {
      military_service: true,
      military_service_history: [{ ...PERIOD, to: 'present' }],
    };
    expect(has(p, ACT, '#isOngoing_chk-input')).toBe(true);
    expect(has(p, ACT, '#toServiceYear_sltDateYear')).toBe(false);
  });

  it('Yes with an incomplete period: Yes kept (a declaration), the gaps noted', () => {
    const long = 'x'.repeat(101);
    for (const period of [
      { ...PERIOD, location: undefined },
      { ...PERIOD, details: long },
    ]) {
      const p = { military_service: true, military_service_history: [period] };
      expect(writes(p, ACT)).toContainEqual([YES, 'Yes']);
      expect(has(p, ACT, '#workHistory_add_button')).toBe(false);
      expect(note(p, ACT, 'Military or police service details')?.note).toMatch(
        /period 1: (where you were stationed|a description .* at most 100 characters)/,
      );
    }
  });

  it('No: no rows and no note', () => {
    const p = { military_service: false, military_service_history: [PERIOD] };
    expect(writes(p, ACT)).toContainEqual([
      '#servedArmy_radio-button-02-input',
      'No',
    ]);
    expect(has(p, ACT, '#workHistory_add_button')).toBe(false);
    expect(note(p, ACT, 'Military or police service details')).toBeUndefined();
  });

  it('the interview asks the periods only after a Yes, on tr-rt routes only', () => {
    expect(asked({ military_service: true })).toContain(
      'military_service_history',
    );
    expect(asked({ military_service: false })).not.toContain(
      'military_service_history',
    );
    expect(
      asked({ military_service: true, military_service_history: [PERIOD] }),
    ).not.toContain('military_service_history');
    expect(
      asked({
        military_service: true,
        military_service_history: [{ ...PERIOD, country: '' }],
      }),
    ).toContain('military_service_history');
    expect(asked({ military_service: true }, SUPER)).toContain(
      'military_service_history',
    );
    for (const ctx of [ETA, EE])
      expect(keys(ctx)).not.toContain('military_service_history');
  });
});

// ── 7. Tuberculosis result (confirmed) ──────────────────────────────────────
describe('/medical-tuberculosis: test result (-01 Yes / -02 No, confirmed live)', () => {
  const TB = { tuberculosis_contact: true, tuberculosis_tested: true };
  it.each([
    [true, '#fiveYearsPostive_radio-button-01-input'],
    [false, '#fiveYearsPostive_radio-button-02-input'],
  ])('%p → %s', (answer, target) => {
    expect(
      writes(
        { ...TB, tuberculosis_test_positive: answer },
        '/medical-tuberculosis',
      ).some(([t]) => t === target),
    ).toBe(true);
  });
});

// ── 8. eTA time zone ────────────────────────────────────────────────────────
describe('eTA: time zone of arrival (160 options, live 2026-10-19)', () => {
  const eta = () => resolvePortalFill('ircc-eta')!;
  const TZ = '[id="applicationDetails.travelDetails_travelDateTimeTimezone"]';
  const DATE = { travel_date_known: true, planned_entry_date: '2026-12-01' };
  const at = (p: Record<string, unknown>) =>
    buildMappingInputs(eta(), p).find((m) => m.targetField === TZ)?.mappedValue;
  const etaLeft = (p: Record<string, unknown>) =>
    portalFillCoverage(eta(), p).pages.flatMap((x) => x.left);

  it('holds the 160 recorded options', () => {
    expect(ETA_TIME_ZONES).toHaveLength(160);
    expect(ETA_TIME_ZONES).toEqual(
      expect.arrayContaining([
        'Eastern Time',
        'Pacific Time',
        'Newfoundland Time',
        'Pakistan Time',
      ]),
    );
  });

  it.each([
    ['Toronto Pearson', 'Eastern Time'],
    ['YUL', 'Eastern Time'],
    ['Montréal', 'Eastern Time'],
    ['Vancouver', 'Pacific Time'],
    ['Calgary', 'Mountain Time'],
    ['Winnipeg', 'Central Time'],
    ['Halifax', 'Atlantic Time'],
    ["St. John's", 'Newfoundland Time'],
    ['EST', 'Eastern Time'],
    ['pacific', 'Pacific Time'],
    ['Pakistan Time', 'Pakistan Time'],
    ['British Columbia', undefined],
    ['Ontario', undefined],
    ['London', undefined],
    ['Lahore', undefined],
  ])('%p → %p', (raw, option) => {
    expect(etaTimeZoneOption(raw)).toBe(option);
  });

  it('written with a time, from the arrival city; no note', () => {
    const p = {
      ...DATE,
      planned_entry_time: '14:30',
      planned_entry_timezone: 'Vancouver',
    };
    expect(at(p)).toBe('Pacific Time');
    expect(etaLeft(p).some((n) => /time zone/i.test(n.label))).toBe(false);
  });

  it('an unplaceable answer: blank, named in the note', () => {
    const p = {
      ...DATE,
      planned_entry_time: '14:30',
      planned_entry_timezone: 'Ontario',
    };
    expect(at(p)).toBeUndefined();
    expect(
      etaLeft(p).find((n) => n.label === 'Time zone of your flight')?.note,
    ).toMatch(/"Ontario"/);
  });

  it('no time, or no travel date: no zone written', () => {
    expect(
      at({ ...DATE, planned_entry_timezone: 'Vancouver' }),
    ).toBeUndefined();
    expect(
      at({
        travel_date_known: false,
        planned_entry_time: '14:30',
        planned_entry_timezone: 'Vancouver',
      }),
    ).toBeUndefined();
  });

  it('the interview asks it with a known date and time only, on the eTA only', () => {
    const ask = (p: Record<string, unknown>) =>
      missingIntakeFacts(p, ETA).map((f) => f.key);
    expect(ask({ ...DATE, planned_entry_time: '14:30' })).toContain(
      'planned_entry_timezone',
    );
    expect(ask({ ...DATE, planned_entry_time: "I don't know" })).not.toContain(
      'planned_entry_timezone',
    );
    expect(ask({ travel_date_known: false })).not.toContain(
      'planned_entry_timezone',
    );
    for (const ctx of [TRV, SUPER, BUSINESS, EE])
      expect(keys(ctx)).not.toContain('planned_entry_timezone');
  });
});
