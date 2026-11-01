import {
  CA_ETA_CONDITIONAL,
  CA_ETA_VISA_EXEMPT,
  CA_ETA_VISAAI_ID,
  computeProgress,
  intakeFactSpecs,
  isIntakeAnswered,
  missingIntakeFacts,
  nationalityCode,
  offeredGenTypesForRoute,
  requiredGenTypesForRoute,
  type ProgressInput,
} from '@visaai/types';

/**
 * Canada eTA as its own route (dry run 2026-10-16, app a37a534b).
 *
 * The eTA is not a visitor visa: its online form asks a fixed set of passport,
 * employment, contact and background questions, it takes no letters, and its
 * checklist is a passport, not a bundle of funds and home-tie evidence.
 */

const ETA = { country: 'CA', visaaiId: CA_ETA_VISAAI_ID };
const TRV = {
  country: 'CA',
  visaaiId: 'ca-visitor-visa-temporary-resident-visa',
};

describe('IRCC eTA nationality lists', () => {
  it('Pakistan is visa-REQUIRED: on neither list', () => {
    expect(CA_ETA_VISA_EXEMPT).not.toContain('PK');
    expect(CA_ETA_CONDITIONAL).not.toContain('PK');
  });

  it('holds the 17 CAN+ countries named by IRCC', () => {
    expect([...CA_ETA_CONDITIONAL].sort()).toEqual(
      [
        'AG', 'AR', 'BR', 'CR', 'ID', 'MY', 'MX', 'MA', 'PA', 'PH', 'KN',
        'LC', 'VC', 'SC', 'TH', 'TT', 'UY',
      ].sort(),
    );
  });

  it('never lists a country on both lists, nor the US or Canada', () => {
    for (const c of CA_ETA_CONDITIONAL) expect(CA_ETA_VISA_EXEMPT).not.toContain(c);
    expect(CA_ETA_VISA_EXEMPT).not.toContain('US');
    expect(CA_ETA_VISA_EXEMPT).not.toContain('CA');
  });

  it.each([
    ['PK', 'PK'],
    ['PAK', 'PK'],
    ['Pakistan', 'PK'],
    ['Pakistani', 'PK'],
    ['GBR', 'GB'],
    ['D', 'DE'],
    ['United Kingdom', 'GB'],
    ['Mexican', 'MX'],
  ])('normalises %s to %s', (raw, code) => {
    expect(nationalityCode(raw)).toBe(code);
  });

  it('returns null for an unrecognisable nationality rather than guessing', () => {
    expect(nationalityCode('Atlantis')).toBeNull();
    expect(nationalityCode('')).toBeNull();
    expect(nationalityCode(undefined)).toBeNull();
  });
});

describe('ROUTE_FACTS — the eTA form', () => {
  const keys = intakeFactSpecs(ETA).map((s) => s.key);

  it.each([
    'applying_on_behalf',
    'travel_document_type',
    'passport_country',
    'nationality',
    'us_permanent_resident',
    'canadian_visa_last_10y',
    'valid_us_nonimmigrant_visa',
    'travel_by_air',
    'passport_number',
    'family_name',
    'given_name',
    'date_of_birth',
    'sex',
    'country_of_birth',
    'city_of_birth',
    'passport_issue_date',
    'passport_expiry_date',
    'previous_canada_application',
    'uci',
    'marital_status',
    'occupation',
    'job_title',
    'employer_name',
    'employment_country',
    'employment_city',
    'employment_since_year',
    'email',
    'preferred_contact_language',
    'residential_address',
    'travel_date_known',
    'planned_entry_date',
    'refused_visa_or_denied_entry',
    'criminal_offence',
    'tuberculosis_last_2_years',
    'tuberculosis_health_care_worker',
    'eta_medical_conditions',
  ])('asks %s', (key) => {
    expect(keys).toContain(key);
  });

  it('does not ask the visitor-visa departure date or stay length', () => {
    expect(keys).not.toContain('planned_departure_date');
    expect(keys).not.toContain('duration_of_stay_days');
    // ...and none of the TRV family questions.
    expect(keys).not.toContain('parents');
    expect(keys).not.toContain('uses_representative');
  });

  it('is not complete after the three base facts (the dry-run defect)', () => {
    const profile = {
      purpose_of_visit: 'tourism',
      employed: true,
      planned_entry_date: '2027-03-01',
      planned_departure_date: '2027-03-10',
    };
    expect(isIntakeAnswered(profile, ETA)).toBe(false);
  });

  it('skips the CAN+ questions for a visa-exempt national', () => {
    const missing = missingIntakeFacts({ nationality: 'GB' }, ETA).map(
      (s) => s.key,
    );
    expect(missing).not.toContain('canadian_visa_last_10y');
    expect(missing).not.toContain('valid_us_nonimmigrant_visa');
  });

  it('asks the CAN+ questions of a Mexican national', () => {
    const missing = missingIntakeFacts({ nationality: 'Mexico' }, ETA).map(
      (s) => s.key,
    );
    expect(missing).toContain('canadian_visa_last_10y');
    expect(missing).toContain('valid_us_nonimmigrant_visa');
  });

  it('asks the entry date only when the travel date is known', () => {
    expect(
      missingIntakeFacts({ travel_date_known: 'no' }, ETA).map((s) => s.key),
    ).not.toContain('planned_entry_date');
    expect(
      missingIntakeFacts({ travel_date_known: 'yes' }, ETA).map((s) => s.key),
    ).toContain('planned_entry_date');
  });

  it('asks the health-care-worker question only after a TB yes', () => {
    expect(
      missingIntakeFacts({ tuberculosis_last_2_years: 'no' }, ETA).map(
        (s) => s.key,
      ),
    ).not.toContain('tuberculosis_health_care_worker');
    expect(
      missingIntakeFacts({ tuberculosis_last_2_years: 'yes' }, ETA).map(
        (s) => s.key,
      ),
    ).toContain('tuberculosis_health_care_worker');
  });

  it('leaves the TRV question list unchanged', () => {
    const trv = intakeFactSpecs(TRV).map((s) => s.key);
    expect(trv).toContain('duration_of_stay_days');
    expect(trv).toContain('planned_departure_date');
    // eTA-only questions stay off the TRV (travel_by_air is asked by both
    // since the TRV portal asks it too — live E2E 2026-10-19).
    expect(trv).not.toContain('applying_on_behalf');
    expect(trv).not.toContain('eta_medical_conditions');
  });
});

describe('generated letters per route', () => {
  it('an eTA needs and offers no letters', () => {
    expect(requiredGenTypesForRoute(ETA)).toEqual([]);
    expect(offeredGenTypesForRoute(ETA)).toEqual([]);
  });

  it('every other route keeps LOE + cover letter required, itinerary optional', () => {
    expect(requiredGenTypesForRoute(TRV)).toEqual(['loe', 'cover_letter']);
    expect(offeredGenTypesForRoute(TRV)).toEqual([
      'loe',
      'itinerary',
      'cover_letter',
    ]);
    expect(requiredGenTypesForRoute({})).toEqual(['loe', 'cover_letter']);
  });
});

describe('computeProgress — narrative with no required letters', () => {
  const base: ProgressInput = {
    applicationId: 'a',
    status: 'draft',
    hasProfile: true,
    intakeDone: true,
    requiredChecklist: [],
    requiredGenTypes: [],
    approvedGenTypes: [],
    hasVriScore: false,
    hasPrefill: false,
    submissionStatus: null,
    lastActiveAt: '2026-10-16T00:00:00Z',
    now: '2026-10-16T00:00:00Z',
  };

  it('treats an empty requirement as complete, not as never-completable', () => {
    const p = computeProgress(base);
    const narrative = p.stages.find((s) => s.slug === 'narrative')!;
    expect(narrative.state).toBe('complete');
    expect(narrative.pct).toBe(100);
  });

  it('still requires the letters a route names', () => {
    const p = computeProgress({
      ...base,
      requiredGenTypes: ['loe', 'cover_letter'],
      approvedGenTypes: ['loe', 'itinerary'],
    });
    const narrative = p.stages.find((s) => s.slug === 'narrative')!;
    expect(narrative.state).not.toBe('complete');
    expect(narrative.pct).toBe(50);
  });
});
