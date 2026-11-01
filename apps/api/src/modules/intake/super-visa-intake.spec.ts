import {
  intakeFactSpecs,
  isIntakeAnswered,
  missingIntakeFacts,
} from '@visaai/types';
import { IRCC_PORTAL_ANSWERS } from '../../../test/fixtures/ircc-portal-answers';

/**
 * The Parent and Grandparent Super Visa interview (registry `ca-super-visa`).
 *
 * Dry run 2026-10-16 (application 61f16bb5): the super-visa applicant was
 * asked only the generic IMM 5257 visitor questions. Nothing asked who the
 * host child is, whether they meet the minimum necessary income for their
 * family size, or about the mandatory Canadian medical insurance and the
 * immigration medical exam — the facts IRCC refuses a super visa on.
 */

const SUPER_VISA = { country: 'CA', visaaiId: 'ca-super-visa' };
const TRV = {
  country: 'CA',
  visaaiId: 'ca-visitor-visa-temporary-resident-visa',
};

const VISITOR_ANSWERS = {
  purpose_of_visit: 'family visit',
  employed: false,
  planned_entry_date: '2027-03-01',
  planned_departure_date: '2028-02-28',
  passport_type: 'Regular',
  us_permanent_resident: false,
  has_valid_us_visa: false,
  previously_visited_canada: false,
  uses_representative: false,
  ...IRCC_PORTAL_ANSWERS,
};

/** Every super-visa question answered for a fully documented case. */
const SUPER_VISA_ANSWERS = {
  inviter_name: 'Mian Muhammad Bilawal',
  inviter_relationship: 'son',
  inviter_status: 'Canadian citizen',
  inviter_date_of_birth: '1992-05-01',
  inviter_address: '1202 Stirling Todd Terrace, Milton, ON L9E 2E2',
  inviter_phone: '905-226-5664',
  inviter_phone_type: 'cell',
  inviter_email: 'host@example.com',
  has_second_inviter: false,
  host_household_members: [
    {
      name: 'Mian Muhammad Bilawal',
      date_of_birth: '1992-05-01',
      relationship_to_host: 'self',
    },
    {
      name: 'Sumera Ahmad',
      date_of_birth: '1968-10-09',
      relationship_to_host: 'mother',
    },
  ],
  host_annual_income_cad: 80000,
  host_income_tax_year: 2025,
  has_co_signer: false,
  has_super_visa_insurance: true,
  medical_insurance_provider: 'Manulife',
  medical_insurance_coverage_cad: 100000,
  medical_insurance_months: 12,
  medical_insurance_paid: 'paid in full',
  medical_exam_last_12_months: false,
  has_property: true,
  has_family_in_home_country: true,
  available_funds: 500000,
  funds_currency: 'PKR',
};

describe('super visa intake questions', () => {
  it('asks who the host is, their household and income, the insurance and the ties home', () => {
    const keys = intakeFactSpecs(SUPER_VISA).map((s) => s.key);
    for (const k of [
      'inviter_name',
      'inviter_relationship',
      'inviter_status',
      'inviter_date_of_birth',
      'inviter_address',
      'host_household_members',
      'host_annual_income_cad',
      'host_income_tax_year',
      'has_co_signer',
      'co_signer_name',
      'co_signer_annual_income_cad',
      'has_super_visa_insurance',
      'medical_insurance_provider',
      'medical_insurance_coverage_cad',
      'medical_insurance_months',
      'medical_insurance_paid',
      'immigration_medical_exam_date',
      'has_property',
      'has_family_in_home_country',
      'available_funds',
    ])
      expect(keys).toContain(k);
  });

  it('asks the super-visa questions straight after the IMM 5257 visitor questions', () => {
    const missing = missingIntakeFacts(
      {
        ...VISITOR_ANSWERS,
        // the dry-run applicant had answered the portal questions up to here
        marital_status: undefined,
      },
      SUPER_VISA,
    ).map((s) => s.key);
    expect(missing[0]).toBe('inviter_name');
    expect(missing).toContain('marital_status');
    expect(missing.indexOf('host_annual_income_cad')).toBeLessThan(
      missing.indexOf('marital_status'),
    );
  });

  it('is not complete on the visitor answers alone', () => {
    expect(isIntakeAnswered(VISITOR_ANSWERS, SUPER_VISA)).toBe(false);
    expect(
      isIntakeAnswered(
        { ...VISITOR_ANSWERS, ...SUPER_VISA_ANSWERS },
        SUPER_VISA,
      ),
    ).toBe(true);
  });

  it('the TRV route is unchanged — none of the super-visa questions are asked', () => {
    const trvKeys = intakeFactSpecs(TRV).map((s) => s.key);
    for (const k of [
      'host_household_members',
      'host_annual_income_cad',
      'has_super_visa_insurance',
      'medical_insurance_provider',
    ])
      expect(trvKeys).not.toContain(k);
    expect(isIntakeAnswered(VISITOR_ANSWERS, TRV)).toBe(true);
  });

  it('co-signer details are asked only when there is a co-signer, and say only the spouse may co-sign', () => {
    const base = { ...VISITOR_ANSWERS, ...SUPER_VISA_ANSWERS };
    expect(missingIntakeFacts(base, SUPER_VISA)).toEqual([]);
    const withCoSigner = { ...base, has_co_signer: true };
    expect(
      missingIntakeFacts(withCoSigner, SUPER_VISA).map((s) => s.key),
    ).toEqual([
      'co_signer_name',
      'co_signer_relationship',
      'co_signer_annual_income_cad',
    ]);
    const question = intakeFactSpecs(SUPER_VISA).find(
      (s) => s.key === 'has_co_signer',
    )!.question;
    expect(question).toMatch(/spouse or common-law partner/i);
    expect(question).toMatch(/sibling/i);
  });

  it('insurance details are asked only once insurance is bought', () => {
    const base = { ...VISITOR_ANSWERS, ...SUPER_VISA_ANSWERS };
    const noPolicy: Record<string, unknown> = {
      ...base,
      has_super_visa_insurance: false,
    };
    for (const k of [
      'medical_insurance_provider',
      'medical_insurance_coverage_cad',
      'medical_insurance_months',
      'medical_insurance_paid',
    ])
      delete noPolicy[k];
    expect(missingIntakeFacts(noPolicy, SUPER_VISA)).toEqual([]);
  });

  it('accepts what the dry run already recorded under other keys', () => {
    const recorded = {
      ...VISITOR_ANSWERS,
      ...SUPER_VISA_ANSWERS,
      // dry-run profile: insurance recorded as travel medical insurance
      has_super_visa_insurance: undefined,
      medical_insurance_months: undefined,
      has_travel_medical_insurance: true,
      travel_medical_insurance_duration_months: 12,
    };
    const keys = missingIntakeFacts(recorded, SUPER_VISA).map((s) => s.key);
    expect(keys).not.toContain('has_super_visa_insurance');
    expect(keys).not.toContain('medical_insurance_months');
  });

  it('a household size alone satisfies the household question only with the names asked for in the letter', () => {
    const p: Record<string, unknown> = {
      ...VISITOR_ANSWERS,
      ...SUPER_VISA_ANSWERS,
    };
    delete p.host_household_members;
    p.host_family_size = 3;
    expect(missingIntakeFacts(p, SUPER_VISA).map((s) => s.key)).toEqual([
      'host_household_members',
    ]);
  });

  it('asks for the medical exam date once the exam is done', () => {
    const p = {
      ...VISITOR_ANSWERS,
      ...SUPER_VISA_ANSWERS,
      medical_exam_last_12_months: true,
    };
    expect(missingIntakeFacts(p, SUPER_VISA).map((s) => s.key)).toEqual([
      'immigration_medical_exam_date',
      // IRCC's /medical-background-questions asks the IME/UMI number too.
      'medical_exam_number',
    ]);
  });
});

/**
 * Audit 2026-10-19: the host's phone, phone type and email and the "second
 * inviter" yes/no hung off `family_in_destination`, which the super visa
 * interview never asks — so none of them was asked and IRCC's /inviter-info
 * went blank. Every earlier fixture set `family_in_destination: true`, which
 * hid it. These profiles never set it.
 */
describe('super visa intake — host contact and second inviter, with no family_in_destination', () => {
  const answered = (): Record<string, unknown> => ({
    ...VISITOR_ANSWERS,
    ...SUPER_VISA_ANSWERS,
  });
  const without = (...keys: string[]) => {
    const p = answered();
    for (const k of keys) delete p[k];
    expect(p.family_in_destination).toBeUndefined();
    return p;
  };

  it("asks the host's phone, phone type and email", () => {
    const keys = missingIntakeFacts(
      without('inviter_phone', 'inviter_phone_type', 'inviter_email'),
      SUPER_VISA,
    ).map((s) => s.key);
    expect(keys).toEqual(['inviter_phone', 'inviter_phone_type', 'inviter_email']);
  });

  it('asks whether a second person is inviting them', () => {
    expect(
      missingIntakeFacts(without('has_second_inviter'), SUPER_VISA).map(
        (s) => s.key,
      ),
    ).toEqual(['has_second_inviter']);
  });

  it("No: the second inviter's details are not asked", () => {
    expect(
      missingIntakeFacts(
        { ...without(), has_second_inviter: false },
        SUPER_VISA,
      ),
    ).toEqual([]);
  });

  it("Yes: the second inviter's details are asked", () => {
    expect(
      missingIntakeFacts(
        { ...without(), has_second_inviter: true },
        SUPER_VISA,
      ).map((s) => s.key),
    ).toEqual([
      'second_inviter_name',
      'second_inviter_relationship',
      'second_inviter_address',
      'second_inviter_phone',
      'second_inviter_phone_type',
      'second_inviter_email',
    ]);
  });

  it('the TRV route still asks them only when family is in Canada', () => {
    const trv = (p: Record<string, unknown>) =>
      missingIntakeFacts(p, TRV).map((s) => s.key);
    for (const k of ['inviter_phone', 'inviter_email', 'has_second_inviter'])
      expect(trv(VISITOR_ANSWERS)).not.toContain(k);
    const family = trv({ ...VISITOR_ANSWERS, family_in_destination: true });
    for (const k of ['inviter_phone', 'inviter_email', 'has_second_inviter'])
      expect(family).toContain(k);
    const trvSpec = intakeFactSpecs(TRV).find((s) => s.key === 'has_second_inviter');
    expect(trvSpec?.when).toBe('family_in_destination');
  });
});
