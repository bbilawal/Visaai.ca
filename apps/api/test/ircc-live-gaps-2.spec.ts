/**
 * Second half of the LIVE fresh super visa draft (2026-10-18, draft 12555431,
 * app 61f16bb5), ids verified on the portal: second inviter, funds, the
 * 10-year work history (homemaker), the refusal question, the medical exam
 * number, and the Forms-page questions that complete child/parent rows.
 */
import '../src/modules/automation/portal-fills/canada-ircc';
import '../src/modules/automation/portal-fills/canada-ircc-eta';
import '../src/modules/automation/portal-fills/canada-ircc-super-visa';
import type { PrefilledFormField } from '@visaai/types';
import {
  applyPrefillOverrides,
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import {
  resolvePortalFill,
  resolvePortalFillFor,
} from '../src/strategies/portal-integration/portal-fill.registry';
import {
  finalizeFields,
  type FinalizeContext,
} from '../src/modules/prefill/graphs/nodes/finalize-fields';

type M = ReturnType<typeof resolvePortalFill> & object;
const trv = () => resolvePortalFill('ircc')!;
const sv = () => resolvePortalFillFor('ircc', 'ca-super-visa')!;
const eta = () => resolvePortalFill('ircc-eta')!;

const PARENT: Record<string, unknown> = {
  given_name: 'Muzaffar',
  family_name: 'Ahmad',
  date_of_birth: '1958-03-09',
  nationality: 'PAK',
  country_of_residence: 'Pakistan',
  residential_address: {
    street: 'House 12, Street 4',
    city: 'Rawalpindi',
    country: 'Pakistan',
  },
  passport_number: 'AB1234567',
  purpose_of_visit: 'family visit',
  planned_entry_date: '2027-03-01',
  planned_departure_date: '2028-02-28',
  host_name: 'Ali Ahmad',
  inviter_relationship: 'son',
  inviter_address: '1228 Turner Drive, Milton, ON L9T 5R6',
};

const on = (m: M, p: Record<string, unknown>, page: string) =>
  buildMappingInputs(m, p).filter((x) => x.page === page);
const val = (m: M, p: Record<string, unknown>, page: string, target: string) =>
  on(m, p, page).find((x) => x.targetField === target)?.mappedValue;
const left = (m: M, p: Record<string, unknown>, page: string) =>
  portalFillCoverage(m, p).pages.find((x) => x.page === page)?.left ?? [];

describe('1. second inviter', () => {
  const SECOND = {
    ...PARENT,
    has_second_inviter: true,
    second_inviter_name: 'Sara Ahmad',
    second_inviter_relationship: 'daughter-in-law',
    second_inviter_address: '45 Main Street, Milton, ON L9T 2P1',
    second_inviter_phone: '647-819-8953',
    second_inviter_phone_type: 'cell',
    second_inviter_email: 'sara@example.com',
  };

  it('fills the block from second_inviter_* keys', () => {
    const at = (t: string) => val(sv(), SECOND, '/inviter-info', t);
    expect(at('#secondInviter_lastName_input')).toBe('Ahmad');
    expect(at('#secondInviter_firstName_input')).toBe('Sara');
    expect(at('#relationInviterTwo_select')).toBe('Family member');
    expect(at('#manualEntryaddress_inviterTwoAddress-input')).toBe('Yes');
    expect(at('#city_inviterTwoAddress')).toBe('Milton');
    expect(at('#postalcode_inviterTwoAddress')).toBe('L9T 2P1');
    expect(at('#telType_phoneNumberInviterTwo_radio-button-02-input')).toBe(
      'Cellular',
    );
    expect(at('#telNumber_phoneNumberInviterTwo')).toBe('6478198953');
    expect(at('#emailAddressInviterTwo_input')).toBe('sara@example.com');
    expect(
      left(sv(), SECOND, '/inviter-info').some(
        (l) => l.label === 'Second inviter',
      ),
    ).toBe(false);
  });

  it("never copies the host's details for a second inviter who lacks them", () => {
    const p = {
      ...PARENT,
      has_second_inviter: true,
      second_inviter_name: 'Sara Ahmad',
    };
    const page = on(sv(), p, '/inviter-info');
    expect(
      page.some((x) => /inviterTwoAddress|InviterTwo/.test(x.targetField)),
    ).toBe(false);
    const note = left(sv(), p, '/inviter-info').find(
      (l) => l.label === 'Second inviter',
    );
    expect(note?.note).toMatch(/never copies your host/);
  });

  it('writes nothing for a second inviter when the answer is No', () => {
    const p = { ...SECOND, has_second_inviter: false };
    expect(
      on(sv(), p, '/inviter-info').some((x) =>
        /secondInviter|InviterTwo/.test(x.targetField),
      ),
    ).toBe(false);
  });
});

describe('2. funds', () => {
  const at = (p: Record<string, unknown>) =>
    val(trv(), { ...PARENT, ...p }, '/finances', '#moneyDetails_input');
  it('reads available_funds when the currency is CAD (live)', () => {
    expect(at({ available_funds: 5000, funds_currency: 'CAD' })).toBe('5000');
  });
  it('never presents another or an unstated currency as CAD', () => {
    expect(
      at({ available_funds: 5000, funds_currency: 'PKR' }),
    ).toBeUndefined();
    expect(at({ available_funds: 5000 })).toBeUndefined();
  });
  it('a CAD-named amount still wins', () => {
    expect(
      at({
        available_funds_cad: 7000,
        available_funds: 5000,
        funds_currency: 'CAD',
      }),
    ).toBe('7000');
  });
});

describe('3. work history for a homemaker', () => {
  const HOME = { ...PARENT, occupation: 'Homemaker', employed: false };

  it('an ongoing Homemaker row when since-when is known', () => {
    const p = { ...HOME, occupation_since: '1988-09' };
    const page = on(sv(), p, '/activities');
    const by = (k: string) => page.filter((x) => x.fieldKey === k);
    expect(by('ircc_work_homemaker_row')[0]?.mappedValue).toBe(
      'Homemaker since 1988-09',
    );
    expect(by('ircc_work_homemaker_activity')[0]?.mappedValue).toBe(
      'Homemaker',
    );
    expect(by('ircc_work_homemaker_ongoing')[0]?.mappedValue).toBe('Yes');
    expect(by('ircc_work_homemaker_from').map((x) => x.mappedValue)).toEqual([
      '1988',
      '09',
    ]);
    // Older than 10 years: the work history needs nothing else.
    expect(left(sv(), p, '/activities').map((l) => l.label)).not.toContain(
      'Work history (past 10 years, no gaps)',
    );
  });

  it('without a date: no row, a note, and a Forms question', () => {
    expect(
      on(sv(), HOME, '/activities').some((x) =>
        x.fieldKey.startsWith('ircc_work_homemaker'),
      ),
    ).toBe(false);
    expect(left(sv(), HOME, '/activities').map((l) => l.label)).toContain(
      'Homemaker period',
    );
    const out = finalizeFields([], ctx(HOME));
    expect(out.find((f) => f.key === 'occupation_since')?.label).toMatch(
      /homemaker/i,
    );
  });

  it('a retired applicant gets the retirement question, and its answer makes the row', () => {
    const RET = { ...PARENT, occupation: 'Retired' };
    expect(
      finalizeFields([], ctx(RET)).find((f) => f.key === 'occupation_since')
        ?.label,
    ).toMatch(/retired/i);
    const page = on(
      sv(),
      { ...RET, occupation_since: '2016-10' },
      '/activities',
    );
    expect(
      page.find((x) => x.fieldKey === 'ircc_work_retired_row')?.mappedValue,
    ).toBe('Retired since 2016-10');
  });
});

describe('4. refusal from the interview keys', () => {
  const target = (p: Record<string, unknown>) =>
    on(trv(), { ...PARENT, ...p }, '/validity-status').find(
      (x) => x.fieldKey === 'refused_or_ordered_to_leave',
    )?.targetField;
  it('all three false → No', () => {
    expect(
      target({
        visa_refusal_history: false,
        denied_entry_history: false,
        ordered_to_leave_country: false,
      }),
    ).toBe('#refusedVisaInOtherCountry_radio-button-02-input');
  });
  it('any true → Yes; one unknown → unanswered', () => {
    expect(
      target({
        visa_refusal_history: true,
        denied_entry_history: false,
        ordered_to_leave_country: false,
      }),
    ).toBe('#refusedVisaInOtherCountry_radio-button-01-input');
    expect(
      target({ visa_refusal_history: false, denied_entry_history: false }),
    ).toBeUndefined();
  });
});

describe('5. medical exam number', () => {
  const at = (n: string) =>
    val(
      sv(),
      {
        ...PARENT,
        medical_exam_last_12_months: 'Yes',
        medical_exam_reference_number: n,
      },
      '/medical-background-questions',
      '#medicalNumber_input',
    );
  it.each([
    ['AB12345678', 'AB12345678'],
    ['ab 123-456-789', 'AB123456789'],
    ['U123456789', 'U123456789'],
    ['12345678', '12345678'],
  ])('%s → %s', (raw, want) => {
    expect(at(raw)).toBe(want);
  });
  it.each(['1234567890', 'X1234', 'ABC12345678'])(
    '%s is not written; the applicant is told',
    (raw) => {
      expect(at(raw)).toBeUndefined();
      const p = {
        ...PARENT,
        medical_exam_last_12_months: 'Yes',
        medical_exam_reference_number: raw,
      };
      expect(
        left(sv(), p, '/medical-background-questions').map((l) => l.label),
      ).toContain('Medical exam IME/UMI number');
    },
  );
  it('a number read from a document on the Forms page reaches IRCC', () => {
    const f: PrefilledFormField = {
      key: 'medical_exam_reference_number',
      label: 'Medical exam reference number',
      value: 'AB12345678',
      source: 'document',
    };
    const q = applyPrefillOverrides(
      sv(),
      { ...PARENT, medical_exam_last_12_months: 'Yes' },
      [f],
    );
    expect(
      val(sv(), q, '/medical-background-questions', '#medicalNumber_input'),
    ).toBe('AB12345678');
  });
});

function ctx(profile: Record<string, unknown>): FinalizeContext {
  return {
    applicantName: 'MUZAFFAR AHMAD',
    profile,
    documentFields: {},
    documentFieldsByType: {},
    otherPartyDocuments: [],
    accountProfile: {},
    route: { country: 'CA', visaaiId: 'ca-super-visa' },
  };
}

describe('6/7. Forms-page questions that complete rows', () => {
  it('biometrics is asked on TRV and super visa', () => {
    for (const visaaiId of [
      'ca-super-visa',
      'ca-visitor-visa-temporary-resident-visa',
    ]) {
      const out = finalizeFields([], {
        ...ctx(PARENT),
        route: { country: 'CA', visaaiId },
      });
      expect(out.map((f) => f.key)).toContain('biometrics_given');
    }
  });

  it("children's countries of birth are asked, and the answer completes the row", () => {
    const kid = {
      name: 'Sajawal Ahmad',
      relationship: 'son',
      date_of_birth: '1989-10-14',
      same_address: 'No',
      address: '1228 Turner Drive, Milton, ON L9T 5R6, Canada',
      coming_to_canada: 'No',
    };
    const p = { ...PARENT, has_children: 'Yes', children: [kid] };
    expect(finalizeFields([], ctx(p)).map((f) => f.key)).toContain(
      'children_countries_of_birth',
    );
    expect(
      on(sv(), p, '/family-info-children').some((x) =>
        /countryOfBirthChild/.test(x.targetField),
      ),
    ).toBe(false);
    const q = applyPrefillOverrides(sv(), p, [
      {
        key: 'children_countries_of_birth',
        label: 'Children: country of birth',
        value: 'Sajawal Ahmad: Pakistan',
        source: 'applicant',
      },
    ]);
    expect(
      on(sv(), q, '/family-info-children').some((x) =>
        /countryOfBirthChild/.test(x.targetField),
      ),
    ).toBe(true);
  });

  it('parents: DOB, country of birth, occupation, address and coming are asked', () => {
    const p = {
      ...PARENT,
      father_name: 'Ahmad Din',
      mother_name: 'Fatima Bibi',
    };
    const keys = finalizeFields([], ctx(p)).map((f) => f.key);
    for (const role of ['father', 'mother'])
      expect(keys).toEqual(
        expect.arrayContaining([
          `${role}_date_of_birth`,
          `${role}_country_of_birth`,
          `${role}_occupation`,
          `${role}_same_address`,
          `${role}_coming_to_canada`,
        ]),
      );
  });
});

describe('isolation', () => {
  it('super visa purpose stays 472', () => {
    expect(
      on(sv(), { ...PARENT, ircc_visa_purpose: 'Tourism' }, '/purpose').map(
        (x) => x.targetField,
      ),
    ).toContain('#visaPurpose_radio-button-472-input');
  });
  it('eTA has none of the new keys', () => {
    expect(
      eta().some((f) =>
        /second_inviter|homemaker|ircc_medical_exam_number/.test(f.profileKey),
      ),
    ).toBe(false);
  });
});
