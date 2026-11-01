/**
 * CONTRACT between the eTA interview (IRCC_ETA_FACTS, @visaai/types
 * intake-requirements) and the eTA portal mapping ('ircc-eta').
 *
 * The two were built in parallel and disagreed on keys: in the consultant
 * review of app 2f1c9cc9 (dry run 2026-10-17, British persona) only the TB
 * answer mapped — refusals, criminality and the listed conditions were stored
 * under the interview's keys, which the mapping never read — and the one-line
 * address put "England" in City/town.
 *
 * Every interview fact that is a question on the eTA form must map from its
 * canonical key alone. A fact that is not mapped is listed in NOT_MAPPED with
 * the reason, so a new interview fact fails here until someone decides.
 */
import '../src/modules/automation/portal-fills/canada-ircc'; // registers 'ircc'
import '../src/modules/automation/portal-fills/canada-ircc-eta'; // registers 'ircc-eta'
import { IRCC_ETA_FACTS } from '@visaai/types';
import { buildMappingInputs } from '../src/modules/automation/fill-instructions';
import { resolvePortalFill } from '../src/strategies/portal-integration/portal-fill.registry';
import { parseAddressLine } from '../src/modules/automation/portal-fills/ircc-profile';

const mapping = () => resolvePortalFill('ircc-eta')!;
const id = (suffix: string) => `[id="applicationDetails.${suffix}"]`;
const writes = (p: Record<string, unknown>) =>
  buildMappingInputs(mapping(), p).map(
    (i) => [i.targetField, i.mappedValue] as [string, string],
  );

/** The stored profile of app 2f1c9cc9, as the review read it. */
const PROD_PROFILE: Record<string, unknown> = {
  refused_visa_or_denied_entry: false,
  criminal_offence: false,
  eta_medical_conditions: false,
  tuberculosis_last_2_years: false,
  residential_address:
    '10 Test Street, London, Greater London, SW1A 1AA, England, United Kingdom',
  email: 'dryrun.test@example.com',
  preferred_contact_language: 'English',
  country_of_birth: 'England',
  passport_country: 'United Kingdom',
  city_of_birth: 'London',
};

const BG = {
  refused: id('backgroundQuestions_refusedVisaOrPermitOrDeniedEntryToCanada'),
  criminal: id(
    'backgroundQuestions_committedOrArrestedOrChargedOrConvictedOfCriminalOffenceAnywhere',
  ),
  tb: id(
    'backgroundQuestions_inThePastTwoYearsWereYouDiagnosedOrInCloseContactWithTuberculosis',
  ),
  conditions: id('backgroundQuestions_doYouHaveOneOfTheseConditions'),
};

/** A Mexican national (CAN+) flying to Canada, not a U.S. permanent resident. */
const CAN_PLUS_FLYING = {
  nationality: 'Mexico',
  us_permanent_resident: false,
  travel_by_air: true,
};
const CAN_PLUS_US_VISA = {
  ...CAN_PLUS_FLYING,
  canadian_visa_last_10y: false,
  valid_us_nonimmigrant_visa: true,
};

/**
 * Each mapped interview fact: a sample answer, the context it needs (a
 * follow-up's parent), and the field + value it must produce.
 */
const MAPPED: Record<
  string,
  {
    value: unknown;
    with?: Record<string, unknown>;
    field: string;
    expect: string;
  }
> = {
  applying_on_behalf: {
    value: false,
    field: '[id="welcome_isRepresentative"]',
    expect: 'No',
  },
  travel_document_type: {
    value: 'regular passport',
    field: id('prerequisite_travelDocumentType'),
    expect: 'Passport - ordinary/regular',
  },
  passport_country: {
    value: 'United Kingdom',
    field: id('prerequisite_countryOfCitizenship'),
    expect: 'GBR (UK - British citizen)',
  },
  nationality: {
    value: 'United Kingdom',
    field: id('prerequisite_passportNotedNationality'),
    expect: 'UK - British citizen',
  },
  passport_number: {
    value: '123456789',
    field: id('personalDetails_passportNumber'),
    expect: '123456789',
  },
  family_name: {
    value: 'Smith',
    field: id('personalDetails_lastName'),
    expect: 'Smith',
  },
  given_name: {
    value: 'Jane',
    field: id('personalDetails_firstName'),
    expect: 'Jane',
  },
  date_of_birth: {
    value: '1960-05-01',
    field: id('personalDetails_dobMonth'),
    expect: 'May',
  },
  sex: { value: 'F', field: id('personalDetails_gender'), expect: 'Female' },
  country_of_birth: {
    value: 'England',
    field: id('personalDetails_countryOfBirth'),
    expect: 'England',
  },
  city_of_birth: {
    value: 'London',
    field: id('personalDetails_cityTownOfBirth'),
    expect: 'London',
  },
  passport_issue_date: {
    value: '2022-03-04',
    field: id('personalDetails_issueDateYear'),
    expect: '2022',
  },
  passport_expiry_date: {
    value: '2032-03-03',
    field: id('personalDetails_expiryDateYear'),
    expect: '2032',
  },
  previous_canada_application: {
    value: false,
    field: id('personalDetails_hasPreviouslyAppliedToCanada'),
    expect: 'No',
  },
  marital_status: {
    value: 'single',
    field: id('personalDetails_maritalStatus'),
    expect: 'Never Married/Single',
  },
  occupation: {
    value: 'Retired',
    field: id('employmentDetails_occupation'),
    expect: 'Retired',
  },
  eta_occupation_group: {
    value: 'Health occupations',
    field: id('employmentDetails_occupation'),
    expect: 'Health occupations',
  },
  job_title: {
    value: 'Software Engineer',
    field: id('employmentDetails_title'),
    expect: 'Computer and information systems professionals',
  },
  employer_name: {
    value: 'University of Leeds',
    with: { occupation: 'Student' },
    field: id('employmentDetails_companyEmployerSchoolFacilityName'),
    expect: 'University of Leeds',
  },
  employment_country: {
    value: 'England',
    with: { occupation: 'Student' },
    field: id('employmentDetails_country'),
    expect: 'England',
  },
  employment_city: {
    value: 'Leeds',
    with: { occupation: 'Student' },
    field: id('employmentDetails_city'),
    expect: 'Leeds',
  },
  employment_since_year: {
    value: '2019',
    with: { occupation: 'Student' },
    field: id('employmentDetails_fromDateYear'),
    expect: '2019',
  },
  uci: {
    value: '1234-5678',
    with: { previous_canada_application: true },
    field: id('personalDetails_uci'),
    expect: '1234-5678',
  },
  email: {
    value: 'a@example.com',
    field: id('contactDetails_emailAddress'),
    expect: 'a@example.com',
  },
  preferred_contact_language: {
    value: 'English',
    field: id('contactDetails_languageOfPreference'),
    expect: 'English',
  },
  residential_address: {
    value: '10 Test Street, London, England',
    field: id('contactDetails_city'),
    expect: 'London',
  },
  travel_date_known: {
    value: true,
    field: id('travelDetails_isTravelDateKnown'),
    expect: 'Yes',
  },
  planned_entry_date: {
    value: '2026-12-01',
    field: id('travelDetails_travelDateMonth'),
    expect: 'December',
  },
  planned_entry_time: {
    value: '14:30',
    with: { travel_date_known: true, planned_entry_date: '2026-12-01' },
    field: id('travelDetails_travelDateTimeHour'),
    expect: '14',
  },
  planned_entry_timezone: {
    value: 'Toronto Pearson',
    with: {
      travel_date_known: true,
      planned_entry_date: '2026-12-01',
      planned_entry_time: '14:30',
    },
    field: id('travelDetails_travelDateTimeTimezone'),
    expect: 'Eastern Time',
  },
  other_citizenships: {
    value: ['Ireland'],
    with: { nationality: 'GBR' },
    field: id('personalDetails_additionalCitizenship'),
    expect: 'Ireland',
  },
  refused_visa_or_denied_entry: {
    value: false,
    field: BG.refused,
    expect: 'No',
  },
  criminal_offence: { value: false, field: BG.criminal, expect: 'No' },
  tuberculosis_last_2_years: { value: false, field: BG.tb, expect: 'No' },
  eta_medical_conditions: {
    value: false,
    field: BG.conditions,
    expect: 'None of the above',
  },
  eta_medical_condition: {
    value: 'Untreated syphilis',
    with: { eta_medical_conditions: true },
    field: BG.conditions,
    expect: 'Untreated syphilis',
  },
  // ── CAN+ chain (Mexican persona, live 2026-10-18) ──
  us_permanent_resident: {
    value: false,
    with: { nationality: 'Mexico' },
    field: id('prerequisite_isPermanentResidentOfUSAndHaveProofOfPermResidence'),
    expect: 'No',
  },
  travel_by_air: {
    value: true,
    with: { nationality: 'Mexico', us_permanent_resident: false },
    field: id('prerequisite_isTravellingByAir'),
    expect: 'Yes',
  },
  canadian_visa_last_10y: {
    value: true,
    with: CAN_PLUS_FLYING,
    field: id('prerequisite.etaExpansion_hasCanadianTemporaryVisa'),
    expect: 'Yes',
  },
  valid_us_nonimmigrant_visa: {
    value: true,
    with: { ...CAN_PLUS_FLYING, canadian_visa_last_10y: false },
    field: id('prerequisite.etaExpansion_hasNonImmigrantVisa'),
    expect: 'Yes',
  },
  us_nonimmigrant_visa_number: {
    value: 'A1234567',
    with: CAN_PLUS_US_VISA,
    field: id('prerequisite.etaExpansion_nonImmigrantVisaNumber'),
    expect: 'A1234567',
  },
  us_nonimmigrant_visa_expiry_date: {
    value: '2028-06-05',
    with: CAN_PLUS_US_VISA,
    field: id('prerequisite.etaExpansion_nonImmigrantVisaNumberExpiryDateMonth'),
    expect: 'June',
  },
  // ── background follow-ups ──
  refusal_details: {
    value: 'Visitor visa refused by the United States in 2019.',
    with: { refused_visa_or_denied_entry: true },
    field: id(
      'backgroundQuestions_refusedVisaOrPermitOrDeniedEntryToCanadaDetails',
    ),
    expect: 'Visitor visa refused by the United States in 2019.',
  },
  criminal_offence_details: {
    value: 'Arrested in Leeds, England, 2015-03, shoplifting; fined GBP 200.',
    with: { criminal_offence: true },
    field: id(
      'backgroundQuestions_committedOrArrestedOrChargedOrConvictedOfCriminalOffenceAnywhereDetails',
    ),
    expect: 'Arrested in Leeds, England, 2015-03, shoplifting; fined GBP 200.',
  },
  tuberculosis_health_care_worker: {
    value: true,
    with: { tuberculosis_last_2_years: true },
    field: id(
      'backgroundQuestions_isYourContactWithTuberculosisTheResultOfBeingAHeathCareWorker',
    ),
    expect: 'Yes',
  },
  tuberculosis_ever_diagnosed: {
    value: false,
    with: {
      tuberculosis_last_2_years: true,
      tuberculosis_health_care_worker: true,
    },
    field: id('backgroundQuestions_haveYouEverBeenDiagnosedWithTuberculosis'),
    expect: 'No',
  },
};

/**
 * Interview facts deliberately not mapped, and why. Empty since the
 * additional-citizenship list was recorded (2026-10-19); a new unmapped fact
 * goes here.
 */
const NOT_MAPPED: Record<string, string> = {};

/**
 * Aliases that name only PART of a background question: a "yes" answers it,
 * a "no" alone does not (another part may be yes).
 */
const PARTIAL_ALIASES: Record<string, string> = {
  refused_visa_or_denied_entry: 'Yes',
  criminal_offence: 'Yes',
};

describe('eTA interview ↔ portal mapping contract', () => {
  const formFacts = IRCC_ETA_FACTS.filter((f) => f.form);

  it('every eTA interview form fact is either mapped or listed as not mapped', () => {
    const decided = new Set([
      ...Object.keys(MAPPED),
      ...Object.keys(NOT_MAPPED),
    ]);
    expect(formFacts.map((f) => f.key).filter((k) => !decided.has(k))).toEqual(
      [],
    );
    const known = new Set(IRCC_ETA_FACTS.map((f) => f.key));
    expect([...decided].filter((k) => !known.has(k))).toEqual([]);
  });

  it('every mapped profileKey is a key the interview collects, or a part derived from one', () => {
    // Keys that are not interview facts themselves: each is read from one.
    const DERIVED: Record<string, string> = {
      ircc_uci: 'the interview\'s uci, filtered ("I don\'t know" is not one)',
      residential_address_apartment: 'part of residential_address',
      residential_address_street_number: 'part of residential_address',
      residential_address_street_name: 'part of residential_address',
      residential_address_city: 'part of residential_address',
      residential_address_country: 'part of residential_address',
    };
    const known = new Set(IRCC_ETA_FACTS.map((f) => f.key));
    const keys = [...new Set(mapping().map((m) => m.profileKey))];
    expect(keys.filter((k) => !known.has(k) && !DERIVED[k])).toEqual([]);
    // The marital-status and employment questions read interview keys only.
    for (const k of [
      'marital_status',
      'occupation',
      'job_title',
      'employer_name',
      'employment_country',
      'employment_city',
      'employment_since_year',
    ]) {
      expect(known.has(k)).toBe(true);
      expect(keys).toContain(k);
    }
  });

  describe.each(
    formFacts.filter((f) => MAPPED[f.key]).map((f) => [f.key, f] as const),
  )('%s', (key, spec) => {
    const c = MAPPED[key];

    it('maps from the canonical key alone', () => {
      const w = writes({ ...c.with, [key]: c.value });
      expect(w).toContainEqual([c.field, c.expect]);
    });

    it.each((spec.aliases ?? []).map((a) => [a]))(
      'maps from the alias %s',
      (alias) => {
        const partial = PARTIAL_ALIASES[key];
        const w = writes({ ...c.with, [alias]: partial ? true : c.value });
        expect(w).toContainEqual([c.field, partial ?? c.expect]);
      },
    );
  });

  it('maps the stored profile of app 2f1c9cc9 exactly', () => {
    expect(writes(PROD_PROFILE)).toEqual([
      [id('prerequisite_countryOfCitizenship'), 'GBR (UK - British citizen)'],
      [id('prerequisite_passportNotedNationality'), 'UK - British citizen'],
      [id('personalDetails_countryOfBirth'), 'England'],
      [id('personalDetails_cityTownOfBirth'), 'London'],
      [id('contactDetails_languageOfPreference'), 'English'],
      [id('contactDetails_emailAddress'), 'dryrun.test@example.com'],
      [id('contactDetails_emailAddressReEnter'), 'dryrun.test@example.com'],
      [id('contactDetails_streetNo'), '10'],
      [id('contactDetails_streetAddress'), 'Test Street'],
      [id('contactDetails_city'), 'London'],
      [id('contactDetails_country'), 'England'],
      [BG.refused, 'No'],
      [BG.criminal, 'No'],
      [BG.tb, 'No'],
      [BG.conditions, 'None of the above'],
    ]);
  });

  describe('background declarations come only from explicit answers', () => {
    it('a "yes" to the refusal or criminality question answers "Yes"', () => {
      expect(writes({ refused_visa_or_denied_entry: true })).toContainEqual([
        BG.refused,
        'Yes',
      ]);
      expect(writes({ criminal_offence: 'yes' })).toContainEqual([
        BG.criminal,
        'Yes',
      ]);
    });

    it('a "no" to only part of a combined question answers nothing', () => {
      const w = writes({
        previous_visa_refused: false,
        criminal_record: false,
      });
      expect(w.find(([f]) => f === BG.refused)).toBeUndefined();
      expect(w.find(([f]) => f === BG.criminal)).toBeUndefined();
    });

    it('conditions: strict reading — none/no/false or an exact option text only', () => {
      const v = (x: unknown) =>
        writes({ eta_medical_conditions: x }).find(
          ([f]) => f === BG.conditions,
        )?.[1] ?? null;
      expect(v(false)).toBe('None of the above');
      expect(v('none')).toBe('None of the above');
      expect(v('None.')).toBe('None of the above');
      expect(v(' NO ')).toBe('None of the above');
      expect(v('None of the above')).toBe('None of the above');
      expect(v('none   of the ABOVE.')).toBe('None of the above');
      expect(v('untreated syphilis')).toBe('Untreated syphilis');
      expect(v('Untreated drug or alcohol addiction')).toBe(
        'Untreated drug or alcohol addiction',
      );
      expect(v('untreated mental health condition with psychosis.')).toBe(
        'Untreated mental health condition with psychosis',
      );
      expect(v(true)).toBeNull();
      expect(v('yes')).toBeNull();
    });

    it.each([
      'No drug or alcohol problems',
      'no, no drug use',
      'I had alcohol addiction but it is treated',
      'No mental health issues',
      'alcohol addiction',
      'syphilis',
      'syphilis and alcohol addiction',
    ])('conditions: free text %p is never mapped', (said) => {
      const w = writes({ eta_medical_conditions: said });
      expect(w.find(([f]) => f === BG.conditions)?.[1] ?? null).toBeNull();
    });

    it.each([
      ['refused_visa_or_denied_entry', BG.refused],
      ['criminal_offence', BG.criminal],
      ['tuberculosis_last_2_years', BG.tb],
    ])('%s: only booleans or exact yes/no answer it', (key, field) => {
      const v = (x: unknown) =>
        writes({ [key]: x }).find(([f]) => f === field)?.[1] ?? null;
      expect(v(false)).toBe('No');
      expect(v(true)).toBe('Yes');
      expect(v(' No ')).toBe('No');
      expect(v('YES')).toBe('Yes');
      for (const free of [
        'No, never',
        'not that I know of',
        'no problems',
        'yes but it was overturned',
        'I was refused once',
      ])
        expect(v(free)).toBeNull();
    });

    it('nothing answered → no background question written', () => {
      const w = writes({ email: 'a@example.com' });
      for (const sel of Object.values(BG))
        expect(w.find(([f]) => f === sel)).toBeUndefined();
    });

    it('a UCI of "I don\'t know" is not written', () => {
      const w = writes({
        previous_canada_application: true,
        uci: "I don't know",
      });
      expect(w.find(([f]) => f === id('personalDetails_uci'))).toBeUndefined();
    });
  });

  describe('one-line residential address', () => {
    const addr = (line: string) => {
      const w = writes({ residential_address: line });
      const at = (s: string) => w.find(([f]) => f === id(s))?.[1];
      return {
        number: at('contactDetails_streetNo'),
        street: at('contactDetails_streetAddress'),
        city: at('contactDetails_city'),
        country: at('contactDetails_country'),
      };
    };

    it('splits number, street, city and nation; district stays unmapped', () => {
      expect(
        addr(
          '10 Test Street, London, Greater London, SW1A 1AA, England, United Kingdom',
        ),
      ).toEqual({
        number: '10',
        street: 'Test Street',
        city: 'London',
        country: 'England',
      });
      expect(
        mapping().some((m) => /contactDetails_district/.test(m.selector)),
      ).toBe(false);
    });

    it('simple "<num> <street>, <city>, <country>"', () => {
      expect(addr('10 Test Street, Leeds, England')).toEqual({
        number: '10',
        street: 'Test Street',
        city: 'Leeds',
        country: 'England',
      });
      expect(addr('138 Millat Colony, Rawalpindi, Pakistan')).toEqual({
        number: '138',
        street: 'Millat Colony',
        city: 'Rawalpindi',
        country: 'Pakistan',
      });
    });

    it('other UK nations are their own option', () => {
      expect(
        addr('5 High Street, Edinburgh, Scotland, United Kingdom').country,
      ).toBe('Scotland');
      expect(addr('5 High Street, Cardiff, Wales').country).toBe('Wales');
      expect(addr('5 High Street, Belfast, Northern Ireland').country).toBe(
        'Northern Ireland',
      );
    });

    it('"United Kingdom" alone leaves the country for the applicant; never a country as city', () => {
      const a = addr('10 Test Street, London, SW1A 1AA, United Kingdom');
      expect(a.country).toBeUndefined();
      expect(a.city).toBe('London');
      for (const line of [
        '10 Test Street, London, Greater London, SW1A 1AA, England, United Kingdom',
        '10 Test Street, England, United Kingdom',
      ])
        expect(['England', 'United Kingdom']).not.toContain(addr(line).city);
    });

    it('parseAddressLine keeps the region, postal code and the nation as written', () => {
      expect(
        parseAddressLine(
          '10 Test Street, London, Greater London, SW1A 1AA, England, United Kingdom',
        ),
      ).toEqual({
        street: '10 Test Street',
        city: 'London',
        province: 'Greater London',
        postalCode: 'SW1A 1AA',
        country: 'GBR',
        countryText: 'England',
      });
      // A city-state keeps its name as the city.
      expect(
        parseAddressLine('1 Orchard Road, Singapore, Singapore')?.city,
      ).toBe('Singapore');
      // No numbered part: the older reading (last part before the country is the city).
      expect(
        parseAddressLine('Millat Colony, Satellite Town, Rawalpindi, Pakistan'),
      ).toMatchObject({
        street: 'Millat Colony, Satellite Town',
        city: 'Rawalpindi',
        country: 'PAK',
      });
      // No country named, the caller knows it.
      expect(
        parseAddressLine('138 Millat Colony, Rawalpindi 46000', 'PAK'),
      ).toMatchObject({
        street: '138 Millat Colony',
        city: 'Rawalpindi',
        postalCode: '46000',
        country: 'PAK',
      });
    });
  });

  describe('parseAddressLine (shared with the TRV and super visa mappings)', () => {
    it.each([
      // [line, street, city, country]
      [
        '123 Block C, Johar Town, Lahore, Pakistan',
        '123 Block C, Johar Town',
        'Lahore',
        'PAK',
      ],
      [
        '45-A, Gulberg III, Lahore, Pakistan',
        '45-A, Gulberg III',
        'Lahore',
        'PAK',
      ],
      [
        '7 Street 12, Bahria Town, Rawalpindi, Pakistan',
        '7 Street 12, Bahria Town',
        'Rawalpindi',
        'PAK',
      ],
      [
        '12 Main Road, Georgia Town, Lahore, Pakistan',
        '12 Main Road, Georgia Town',
        'Lahore',
        'PAK',
      ],
      [
        '12-B, Model Town, Lahore, Pakistan',
        '12-B, Model Town',
        'Lahore',
        'PAK',
      ],
      [
        '10 Test Street, Clapham, London, SW4 0AA, United Kingdom',
        '10 Test Street, Clapham',
        'London',
        'GBR',
      ],
      [
        'House 12, Street 5, F-7/3, Islamabad, Islamabad Capital Territory, 44000, Pakistan',
        'House 12, Street 5, F-7/3',
        'Islamabad',
        'PAK',
      ],
      [
        '10 Test Street, London, Greater London, SW1A 1AA, England, United Kingdom',
        '10 Test Street',
        'London',
        'GBR',
      ],
      [
        '123 Main St, Milton, ON, L9T 1A1, Canada',
        '123 Main St',
        'Milton',
        'CAN',
      ],
      [
        'Apt 4B, 55 King St W, Toronto, ON, Canada',
        'Apt 4B, 55 King St W',
        'Toronto',
        'CAN',
      ],
      [
        'House 12, Street 5, Sector G-9/2, Islamabad, Pakistan',
        'House 12, Street 5, Sector G-9/2',
        'Islamabad',
        'PAK',
      ],
      [
        '138 Millat Colony, Rawalpindi, Pakistan',
        '138 Millat Colony',
        'Rawalpindi',
        'PAK',
      ],
      [
        'Flat 3, 12 Acacia Avenue, Leeds, England',
        'Flat 3, 12 Acacia Avenue',
        'Leeds',
        'GBR',
      ],
      ['5 Mall Road, Lahore, Punjab, Pakistan', '5 Mall Road', 'Lahore', 'PAK'],
    ])('%s', (line, street, city, country) => {
      expect(parseAddressLine(line)).toMatchObject({ street, city, country });
    });

    it('keeps the UK nation as written', () => {
      expect(
        parseAddressLine(
          '10 Test Street, London, Greater London, SW1A 1AA, England, United Kingdom',
        )?.countryText,
      ).toBe('England');
    });

    it('never makes a postal code or a country the city', () => {
      expect(
        parseAddressLine('10 Test Street, England, United Kingdom'),
      ).toBeUndefined();
      expect(
        parseAddressLine('10 Test Street, SW1A 1AA, United Kingdom'),
      ).toBeUndefined();
    });
  });
});
