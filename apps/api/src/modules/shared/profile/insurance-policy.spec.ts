import { choosePolicy, policyDate, readPolicy } from './insurance-policy';

/**
 * Dry run 2026-10-16 (super visa, app 61f16bb5): the applicant uploaded TWO
 * medical insurance policies — an expired 21st Century policy (Jun-01-2025 →
 * May-31-2026) and a covering one (2027-03-01 → 2028-03-01). Every reader took
 * the first insurance document it met, so the letters printed "[medical
 * insurance policy covering … — to be provided]" and the readiness score said
 * the insurance had expired.
 */

const STAY = { entryDate: '2027-03-01', departureDate: '2028-02-28' };

const EXPIRED = {
  full_name: 'AHMAD, Sumera AHMAD, Muzaffar',
  expiry_date: 'May-31-2026',
  insurer_name: '21st Century TRAVEL INSURANCE LIMITED',
  policy_number: '11460162V-A',
  coverage_amount: 100000,
  // what OCR really put here: the holder's DOB and age
  coverage_end_date: '(Jun-15-1961 / 63 yrs)',
  coverage_start_date: 'Jun-01-2025',
};
const COVERING = {
  full_name: 'SUMERA AHMAD',
  insurer_name:
    'TEST DUMMY Canadian Insurance Company Inc., Toronto, Ontario, Canada',
  policy_number: 'SV-DUMMY-2027-001',
  coverage_amount: 100000,
  coverage_end_date: '2028-03-01',
  coverage_start_date: '2027-03-01',
};

describe('policyDate', () => {
  it.each([
    ['2026-05-31', '2026-05-31'],
    ['May-31-2026', '2026-05-31'],
    ['31 May 2026', '2026-05-31'],
    ['31/05/2026', '2026-05-31'],
    ['(Jun-15-1961 / 63 yrs)', null],
    [undefined, null],
  ])('%s → %s', (input, out) => {
    expect(policyDate(input)).toBe(out);
  });
});

describe('readPolicy', () => {
  it('falls back to expiry_date when the end date is unparseable', () => {
    const p = readPolicy(EXPIRED, STAY);
    expect(p.end).toBe('2026-05-31');
    expect(p.coversStay).toBe(false);
  });

  it('a policy running past the departure covers the stay', () => {
    const p = readPolicy(COVERING, STAY);
    expect(p).toMatchObject({
      start: '2027-03-01',
      end: '2028-03-01',
      coverageAmount: 100000,
      policyNumber: 'SV-DUMMY-2027-001',
      coversStay: true,
    });
  });

  it('cannot tell without the stay dates', () => {
    expect(
      readPolicy(COVERING, { entryDate: null, departureDate: null }).coversStay,
    ).toBeNull();
  });

  it('reads a coverage amount printed as text', () => {
    expect(
      readPolicy({ coverage_amount: 'CAD 150,000' }, STAY).coverageAmount,
    ).toBe(150000);
  });
});

describe('choosePolicy', () => {
  it('picks the covering policy whatever the upload order', () => {
    const a = readPolicy(EXPIRED, STAY);
    const b = readPolicy(COVERING, STAY);
    expect(choosePolicy([a, b])?.policyNumber).toBe('SV-DUMMY-2027-001');
    expect(choosePolicy([b, a])?.policyNumber).toBe('SV-DUMMY-2027-001');
  });

  it('prefers an uncheckable policy over one known not to cover', () => {
    const a = readPolicy(EXPIRED, STAY);
    const b = readPolicy({ insurer_name: 'X', policy_number: 'P2' }, STAY);
    expect(choosePolicy([a, b])?.policyNumber).toBe('P2');
  });

  it('with none covering, returns the one ending latest', () => {
    const a = readPolicy(EXPIRED, STAY);
    const b = readPolicy(
      { policy_number: 'LATER', expiry_date: '2027-06-01' },
      STAY,
    );
    const c = choosePolicy([a, b]);
    expect(c?.policyNumber).toBe('LATER');
    expect(c?.coversStay).toBe(false);
  });

  it('none → null', () => {
    expect(choosePolicy([])).toBeNull();
  });
});
