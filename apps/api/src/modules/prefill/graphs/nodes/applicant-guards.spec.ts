import {
  comparableValue,
  isApplicantEmploymentKey,
  isRetiredProfile,
  sanitizeProfile,
} from './applicant-guards';

describe('isApplicantEmploymentKey', () => {
  it.each([
    'job_title',
    'previous_job_title',
    'current_occupation',
    'employer_name',
    'employment_start_date',
    'monthly_income',
    'annual_income',
  ])('%s is an applicant employment field', (k) => {
    expect(isApplicantEmploymentKey(k)).toBe(true);
  });

  it.each([
    'son_employer_name',
    'other_son_annual_income_cad',
    'sponsor_job_title',
    'host_occupation',
    'family_member_employer',
    'spouse_occupation',
    'passport_number',
  ])('%s is NOT an applicant employment field', (k) => {
    expect(isApplicantEmploymentKey(k)).toBe(false);
  });
});

describe('comparableValue', () => {
  it('normalizes a prose date and an ISO date to the same value', () => {
    expect(comparableValue('December 2, 2024.')).toBe(comparableValue('2024-12-02'));
  });
  it('normalizes numbers and numeric strings alike', () => {
    expect(comparableValue(96254)).toBe(comparableValue('96,254'));
  });
  it('ignores case and punctuation', () => {
    expect(comparableValue('HR Data Quality Coordinator')).toBe(
      comparableValue('hr data-quality coordinator'),
    );
  });
});

describe('isRetiredProfile', () => {
  it('reads the retired flag', () => {
    expect(isRetiredProfile({ retired: true })).toBe(true);
    expect(isRetiredProfile({ occupation: 'Retired' })).toBe(true);
    expect(isRetiredProfile({ employed: true })).toBe(false);
  });
});

describe('sanitizeProfile', () => {
  // The prod profile itself had absorbed the son's employment letter.
  const profile = {
    retired: true,
    employed: false,
    full_name: 'MUZAFFAR AHMAD',
    job_title: 'HR Data Quality Coordinator',
    employment_start_date: 'December 2, 2024.',
    son_employer_name: 'Saint Elizabeth Healthcare',
    other_son_annual_income_cad: 96254,
  };
  const otherParty = [
    {
      documentType: 'employment_letter',
      subject: 'unattributed' as const,
      holderName: null,
      fields: {
        job_title: 'HR Data Quality Coordinator',
        monthly_income: 96254,
        employment_start_date: 'December 2, 2024.',
      },
    },
  ];

  it('strips applicant employment values that came from someone else\'s document', () => {
    const { profile: clean, removed } = sanitizeProfile(
      { ...profile, retired: false, employed: true },
      otherParty,
    );
    expect(clean).not.toHaveProperty('job_title');
    expect(clean).not.toHaveProperty('employment_start_date');
    expect(removed).toEqual(expect.arrayContaining(['job_title', 'employment_start_date']));
  });

  it('keeps sponsor-scoped facts — they belong on the sponsor fields', () => {
    const { profile: clean } = sanitizeProfile(profile, otherParty);
    expect(clean.son_employer_name).toBe('Saint Elizabeth Healthcare');
    expect(clean.other_son_annual_income_cad).toBe(96254);
    expect(clean.full_name).toBe('MUZAFFAR AHMAD');
  });

  it('drops current-employment facts for a retired applicant even without a matching document', () => {
    const { profile: clean } = sanitizeProfile(
      { retired: true, employer_name: 'Acme', previous_job_title: 'Teacher' },
      [],
    );
    expect(clean).not.toHaveProperty('employer_name');
    // A genuine PREVIOUS job is still the applicant's history.
    expect(clean.previous_job_title).toBe('Teacher');
  });
});
