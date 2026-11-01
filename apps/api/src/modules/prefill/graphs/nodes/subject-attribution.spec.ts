import {
  classifyDocumentSubject,
  holderNameOf,
  namesMatch,
} from './subject-attribution';

/**
 * Prod defect (2026-10-14 dry run): a retired visitor-visa applicant uploaded
 * his SON's employment letter and bank statement as sponsor evidence. The
 * prefill put the son's HR signatory's job title, the other son's annual salary
 * and the son's start date into the APPLICANT's employment section. Every
 * uploaded document now gets a subject before any value reaches a form field.
 */
describe('namesMatch', () => {
  const applicant = 'MUZAFFAR AHMAD';

  it('matches regardless of order, case and commas', () => {
    expect(namesMatch(applicant, 'Ahmad, Muzaffar')).toBe(true);
    expect(namesMatch(applicant, 'muzaffar ahmad')).toBe(true);
  });

  it('matches when the holder name carries extra tokens (two names on one card)', () => {
    expect(namesMatch(applicant, 'Sumera Ahmad Muzaffar Ahmad')).toBe(true);
  });

  it('tolerates a one-letter OCR slip in a long token', () => {
    expect(namesMatch(applicant, 'MUZAFAR AHMAD')).toBe(true);
  });

  it('rejects a relative who shares one name token (son vs father)', () => {
    expect(namesMatch(applicant, 'Bilawal Muzaffar')).toBe(false);
    expect(namesMatch(applicant, 'SAJAWAL, MIAN MUHAMMAD')).toBe(false);
  });

  it('never matches on missing input', () => {
    expect(namesMatch('', 'Muzaffar Ahmad')).toBe(false);
    expect(namesMatch(applicant, '')).toBe(false);
    expect(namesMatch(applicant, undefined)).toBe(false);
  });
});

describe('holderNameOf', () => {
  it('prefers an account/employee holder over a generic full_name', () => {
    expect(
      holderNameOf({ full_name: 'X Y', account_holder_name: 'Jane Roe' }),
    ).toBe('Jane Roe');
    expect(holderNameOf({ employee_name: 'Jane Roe' })).toBe('Jane Roe');
    expect(holderNameOf({ full_name: 'Jane Roe' })).toBe('Jane Roe');
  });

  it('returns null when the document names nobody', () => {
    expect(holderNameOf({ job_title: 'Analyst' })).toBeNull();
  });
});

describe('classifyDocumentSubject', () => {
  const anchor = 'Muzaffar Ahmad';

  it('a passport naming the applicant is the applicant', () => {
    expect(
      classifyDocumentSubject('passport_copy', { full_name: 'MUZAFFAR AHMAD' }, anchor),
    ).toBe('applicant');
  });

  it('an employment letter that names nobody is NOT the applicant', () => {
    // The exact prod extraction: no employee name, the signatory's title.
    expect(
      classifyDocumentSubject(
        'employment_letter',
        {
          job_title: 'HR Data Quality Coordinator',
          monthly_income: 96254,
          employment_start_date: 'December 2, 2024.',
        },
        anchor,
      ),
    ).toBe('unattributed');
  });

  it('a bank statement in someone else\'s name is a third party', () => {
    expect(
      classifyDocumentSubject(
        'proof_of_funds',
        { account_holder_name: 'SAJAWAL, MIAN MUHAMMAD', account_balance: 96254 },
        anchor,
      ),
    ).toBe('third_party');
  });

  it('a bank statement in the applicant\'s own name is the applicant', () => {
    expect(
      classifyDocumentSubject(
        'bank_statement',
        { account_holder_name: 'Muzaffar Ahmad', account_balance: 5000 },
        anchor,
      ),
    ).toBe('applicant');
  });

  it('an untyped upload carrying employment values is treated like an employment letter', () => {
    expect(
      classifyDocumentSubject('document', { job_title: 'Engineer' }, anchor),
    ).toBe('unattributed');
  });

  it('an invitation letter always describes the host', () => {
    expect(
      classifyDocumentSubject(
        'invitation_letter',
        { host_status: 'a Canadian citizen', full_name: 'Muzaffar Ahmad' },
        anchor,
      ),
    ).toBe('host');
  });

  it('an identity card in another person\'s name is a third party', () => {
    expect(
      classifyDocumentSubject('document', { full_name: 'Mian Abdul Rasheed' }, anchor),
    ).toBe('third_party');
  });

  it('a non-financial document with no name stays with the applicant', () => {
    expect(
      classifyDocumentSubject('passport', { passport_number: 'X1' }, anchor),
    ).toBe('applicant');
  });

  it('with no anchor name, sponsor-capable documents stay unattributed', () => {
    expect(
      classifyDocumentSubject('bank_statement', { account_balance: 500 }, null),
    ).toBe('unattributed');
  });
});

describe('classifyDocumentSubject — card holder unknown (live E2E 2026-10-18)', () => {
  it('a card marked holder_unknown is never the applicant\'s', () => {
    expect(
      classifyDocumentSubject(
        'national_id',
        { national_id_number: '34201-9465270-5', holder_unknown: true },
        'Chaudhary Zeeshan Ali',
      ),
    ).toBe('unattributed');
  });
});

