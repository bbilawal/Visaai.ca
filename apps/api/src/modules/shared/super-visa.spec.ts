import {
  isSuperVisaRoute,
  minimumNecessaryIncome,
  stayLengthPhrase,
  superVisaFamilySize,
  superVisaIncomeCheck,
  superVisaInsuranceCheck,
} from '@visaai/types';

describe('isSuperVisaRoute', () => {
  it('recognises the registry id and nothing else', () => {
    expect(isSuperVisaRoute('ca-super-visa')).toBe(true);
    expect(isSuperVisaRoute('ca-visitor-visa-temporary-resident-visa')).toBe(
      false,
    );
    expect(isSuperVisaRoute(null)).toBe(false);
  });
});

describe('minimumNecessaryIncome (IRCC table, updated 2025-07-29)', () => {
  it('reads the published table', () => {
    expect(minimumNecessaryIncome(1)).toBe(30526);
    expect(minimumNecessaryIncome(4)).toBe(56724);
    expect(minimumNecessaryIncome(7)).toBe(80784);
  });

  it('adds the published amount for each member beyond seven', () => {
    expect(minimumNecessaryIncome(9)).toBe(80784 + 2 * 8224);
  });

  it('prefers the registry parameters when they are given', () => {
    expect(
      minimumNecessaryIncome(2, {
        family_of_2_cad: 40000,
        each_additional_member_cad: 9000,
      }),
    ).toBe(40000);
  });

  it('refuses a size it cannot read', () => {
    expect(minimumNecessaryIncome(0)).toBeNull();
    expect(minimumNecessaryIncome(Number.NaN)).toBeNull();
  });
});

describe('superVisaFamilySize', () => {
  it('counts the listed household members', () => {
    expect(
      superVisaFamilySize({
        host_household_members: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
      }),
    ).toBe(3);
  });

  it('falls back to a stated size, and is null when unknown', () => {
    expect(superVisaFamilySize({ host_family_size: '5' })).toBe(5);
    expect(superVisaFamilySize({})).toBeNull();
  });
});

describe('superVisaIncomeCheck', () => {
  const household = Array.from({ length: 4 }, (_, i) => ({ name: `p${i}` }));

  it('meets the minimum when the host income covers the family size', () => {
    const r = superVisaIncomeCheck({
      host_household_members: household,
      host_annual_income_cad: 80000,
      host_income_tax_year: 2025,
    });
    expect(r).toMatchObject({
      familySize: 4,
      required: 56724,
      hostIncome: 80000,
      total: 80000,
      taxYear: 2025,
      meets: true,
    });
  });

  it('adds a spouse co-signer income', () => {
    const r = superVisaIncomeCheck({
      host_household_members: Array.from({ length: 7 }, () => ({})),
      host_annual_income_cad: 60000,
      has_co_signer: true,
      co_signer_relationship: 'spouse',
      co_signer_annual_income_cad: 30000,
    });
    expect(r.total).toBe(90000);
    expect(r.meets).toBe(true);
  });

  it('does not count a sibling as a co-signer (IRCC: only the spouse or partner)', () => {
    const r = superVisaIncomeCheck({
      host_household_members: Array.from({ length: 7 }, () => ({})),
      host_annual_income_cad: 60000,
      has_co_signer: true,
      co_signer_relationship: 'brother',
      co_signer_annual_income_cad: 104544,
    });
    expect(r.total).toBe(60000);
    expect(r.meets).toBe(false);
    expect(r.coSignerIneligible).toBe(true);
  });

  it('cannot decide without the family size or the income', () => {
    expect(
      superVisaIncomeCheck({ host_annual_income_cad: 80000 }).meets,
    ).toBeNull();
    expect(
      superVisaIncomeCheck({ host_household_members: household }).meets,
    ).toBeNull();
  });
});

describe('superVisaInsuranceCheck', () => {
  it('passes a paid one-year policy with $100,000 cover', () => {
    const r = superVisaInsuranceCheck({
      has_super_visa_insurance: true,
      medical_insurance_provider: 'Manulife',
      medical_insurance_coverage_cad: 100000,
      medical_insurance_months: 12,
      medical_insurance_paid: 'paid in full',
    });
    expect(r.meets).toBe(true);
    expect(r.problems).toEqual([]);
  });

  it('names each shortfall', () => {
    const r = superVisaInsuranceCheck({
      has_super_visa_insurance: true,
      medical_insurance_coverage_cad: 50000,
      medical_insurance_months: 6,
      medical_insurance_paid: 'quote only',
    });
    expect(r.meets).toBe(false);
    expect(r.problems.join(' ')).toMatch(/100,000/);
    expect(r.problems.join(' ')).toMatch(/1 year/);
    expect(r.problems.join(' ')).toMatch(/quote/i);
  });

  it('reports no policy as not meeting the requirement', () => {
    expect(
      superVisaInsuranceCheck({ has_super_visa_insurance: false }).meets,
    ).toBe(false);
    expect(superVisaInsuranceCheck({}).meets).toBeNull();
  });

  it('reads the dry-run keys (travel medical insurance)', () => {
    const r = superVisaInsuranceCheck({
      has_travel_medical_insurance: true,
      travel_medical_insurance_duration_months: 12,
    });
    expect(r.has).toBe(true);
    expect(r.months).toBe(12);
  });
});

describe('stayLengthPhrase', () => {
  it('keeps a day count for a short visit', () => {
    expect(stayLengthPhrase('2027-03-01', '2027-04-30')).toBe('61 days');
  });

  it('describes a year-long stay in months, not days', () => {
    expect(stayLengthPhrase('2027-03-01', '2028-02-28')).toBe('12 months');
    expect(stayLengthPhrase('2027-03-01', '2028-02-29')).toBe('12 months');
  });

  it('says "about" when the months are not whole', () => {
    expect(stayLengthPhrase('2027-03-01', '2027-11-10')).toBe('about 8 months');
  });

  it('is null for unreadable dates', () => {
    expect(stayLengthPhrase('soon', '2027-04-30')).toBeNull();
  });
});
