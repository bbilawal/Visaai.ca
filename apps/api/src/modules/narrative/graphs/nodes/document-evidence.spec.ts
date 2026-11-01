import { evidenceDirective, narrativeEvidence } from './document-evidence';

/**
 * Dry run 2026-10-16 (super visa, application 61f16bb5). The letters:
 *  - were signed "Mian Muhammad" — the host's name, which a host document had
 *    written over the applicant's profile — although the applicant's own
 *    passport (SUMERA AHMAD, AL1183581) had been read and verified;
 *  - claimed "travel medical insurance for the full 365-day duration" while
 *    the uploaded policy ran Jun-01-2025 → May-31-2026 and had failed its
 *    expiry check.
 * What the verified documents say now outranks what the profile claims.
 */

const PASSPORT = {
  document_type: 'passport',
  verification_type: 'identity',
  result: 'pass',
  details_json: {
    extracted_fields: {
      full_name: 'SUMERA AHMAD',
      passport_number: 'AL1183581',
      date_of_birth: '1968-10-09',
    },
  },
};
const INSURANCE = {
  document_type: 'medical_insurance',
  verification_type: 'identity',
  result: 'pass',
  details_json: {
    extracted_fields: {
      insurer_name: '21st Century TRAVEL INSURANCE LIMITED',
      policy_number: '11460162V-A',
      coverage_amount: 100000,
      coverage_start_date: 'Jun-01-2025',
      expiry_date: 'May-31-2026',
    },
  },
};
const INSURANCE_EXPIRY = {
  document_type: 'medical_insurance',
  verification_type: 'expiry',
  result: 'fail',
  details_json: { basis: 'expired', expiry_date: '2026-05-31' },
};

const PROFILE = {
  full_name: 'MIAN MUHAMMAD',
  passport_number: 'AL1183581',
  planned_entry_date: '2027-03-01',
  planned_departure_date: '2028-02-28',
  has_travel_medical_insurance: true,
};

describe('narrativeEvidence', () => {
  it("takes the applicant's name from their own verified passport", () => {
    const e = narrativeEvidence(PROFILE, [PASSPORT]);
    expect(e.applicantName).toBe('Sumera Ahmad');
  });

  it('ignores a passport that is not the applicant’s (another number)', () => {
    const other = {
      ...PASSPORT,
      details_json: {
        extracted_fields: {
          full_name: 'MIAN MUHAMMAD BILAWAL',
          passport_number: 'XX0000000',
        },
      },
    };
    const e = narrativeEvidence(PROFILE, [PASSPORT, other]);
    expect(e.applicantName).toBe('Sumera Ahmad');
    expect(narrativeEvidence(PROFILE, [other]).applicantName).toBeNull();
  });

  it('reads the insurance policy and finds it does not cover the stay', () => {
    const e = narrativeEvidence(PROFILE, [INSURANCE, INSURANCE_EXPIRY]);
    expect(e.insurance).toMatchObject({
      insurer: '21st Century TRAVEL INSURANCE LIMITED',
      policyNumber: '11460162V-A',
      coverageAmount: 100000,
      start: '2025-06-01',
      end: '2026-05-31',
      coversStay: false,
    });
  });

  it('a policy spanning the stay covers it', () => {
    const ok = {
      ...INSURANCE,
      details_json: {
        extracted_fields: {
          ...INSURANCE.details_json.extracted_fields,
          coverage_start_date: '2027-03-01',
          expiry_date: '2028-02-29',
        },
      },
    };
    expect(narrativeEvidence(PROFILE, [ok]).insurance?.coversStay).toBe(true);
  });

  // Prod 2026-10-16 21:35Z: the app held the expired policy AND a covering
  // one; every letter printed the "to be provided" placeholder.
  const COVERING = {
    document_type: 'medical_insurance',
    verification_type: 'identity',
    result: 'pass',
    details_json: {
      extracted_fields: {
        full_name: 'SUMERA AHMAD',
        insurer_name: 'TEST DUMMY Canadian Insurance Company Inc.',
        policy_number: 'SV-DUMMY-2027-001',
        coverage_amount: 100000,
        coverage_start_date: '2027-03-01',
        coverage_end_date: '2028-03-01',
      },
    },
  };

  it.each([
    ['expired first', [INSURANCE, INSURANCE_EXPIRY, COVERING]],
    ['covering first', [COVERING, INSURANCE, INSURANCE_EXPIRY]],
  ])('of two policies, uses the one covering the stay (%s)', (_l, rows) => {
    const e = narrativeEvidence(PROFILE, rows);
    expect(e.insurance).toMatchObject({
      policyNumber: 'SV-DUMMY-2027-001',
      coversStay: true,
    });
    const text = evidenceDirective(e);
    expect(text).toContain('SV-DUMMY-2027-001');
    expect(text).toMatch(/covers the planned stay/);
    expect(text).not.toMatch(/to be provided/);
  });
});

describe('evidenceDirective', () => {
  it('forbids claiming insurance the uploaded policy does not give', () => {
    const text = evidenceDirective(
      narrativeEvidence(PROFILE, [INSURANCE, INSURANCE_EXPIRY]),
    );
    expect(text).toMatch(/does NOT cover the planned stay/);
    expect(text).toContain('2026-05-31');
    expect(text).toMatch(/never (state|claim)/i);
    expect(text).toMatch(/\[/); // a marked placeholder
  });

  it('names and signs for the applicant from the passport', () => {
    const text = evidenceDirective(narrativeEvidence(PROFILE, [PASSPORT]));
    expect(text).toContain('Sumera Ahmad');
    expect(text).toMatch(/sign/i);
  });

  it('says nothing without documents', () => {
    expect(evidenceDirective(narrativeEvidence(PROFILE, []))).toBe('');
  });
});
