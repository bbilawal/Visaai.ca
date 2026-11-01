/**
 * Audit 2026-10-19 (TRV / tr-rt yes-no matrix): answers written wrong, or
 * revealed fields left silently blank, on the visitor-visa form that TRV,
 * super visa and business visitor share. Each fix is checked on its Yes and
 * its No branch, with the interview asking the question under the key the
 * portal mapping reads.
 */
import '../src/modules/automation/portal-fills/canada-ircc'; // registers 'ircc'
import { intakeFactSpecs, missingIntakeFacts } from '@visaai/types';
import {
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import { resolvePortalFill } from '../src/strategies/portal-integration/portal-fill.registry';
import { tripPayer } from '../src/modules/automation/portal-fills/canada-ircc';

const mapping = () => resolvePortalFill('ircc')!;
const TRV = { country: 'CA', visaaiId: 'ca-visitor-visa-temporary-resident-visa' };
const SUPER = { country: 'CA', visaaiId: 'ca-super-visa' };
const BUSINESS = { country: 'CA', visaaiId: 'ca-business-visitors' };
const ETA = { country: 'CA', visaaiId: 'ca-electronic-travel-authorization-eta' };
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
  buildMappingInputs(mapping(), { ...BASE, ...p });
const field = (p: Record<string, unknown>, key: string) =>
  inputs(p).filter((m) => m.fieldKey === key);
const target = (p: Record<string, unknown>, key: string) =>
  field(p, key)[0]?.targetField;
const left = (p: Record<string, unknown>, page: string) =>
  portalFillCoverage(mapping(), { ...BASE, ...p }).pages.find(
    (x) => x.page === page,
  )?.left ?? [];
const asked = (p: Record<string, unknown>, ctx = TRV) =>
  missingIntakeFacts({ ...BASE, ...p }, ctx).map((f) => f.key);
const keys = (ctx: { country: string; visaaiId: string }) =>
  intakeFactSpecs(ctx).map((s) => s.key);

describe('/finances: is someone else giving you money', () => {
  const YES = '#areFundsShared_radio-button-01-input';
  const NO = '#areFundsShared_radio-button-02-input';

  it.each([
    'Pension',
    'My pension',
    'Savings',
    'Bank savings',
    'Personal savings',
    'Retirement savings',
    'Business income',
    'Rental income',
    'My salary',
    'Self',
    'Own funds',
    'No one else, I pay myself',
  ])('"%s" is the applicant\'s own money: No', (who) => {
    expect(target({ trip_expenses_paid_by: who }, 'funds_shared')).toBe(NO);
  });

  it.each([
    'My son',
    'My son Ali Khan',
    'Daughter',
    'The host',
    'A family member',
    'Employer',
    'The Canadian company',
    'Sponsor',
    'The inviting organization',
    'Pension and my son',
  ])('"%s" is someone else: Yes', (who) => {
    expect(target({ trip_expenses_paid_by: who }, 'funds_shared')).toBe(YES);
  });

  it('an unclear payer is left blank with a note, not answered', () => {
    const p = { trip_expenses_paid_by: 'Ali Khan' };
    expect(field(p, 'funds_shared')).toEqual([]);
    expect(left(p, '/finances')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Someone else is giving you money for the trip',
          reason: 'fill_yourself',
          note: expect.stringContaining('Ali Khan'),
        }),
      ]),
    );
    expect(tripPayer('Mr Johnson')).toBeUndefined();
  });

  it('a clear answer gets no unclear-payer note', () => {
    expect(
      left({ trip_expenses_paid_by: 'Pension' }, '/finances').some((n) =>
        /could not tell/.test(n.note ?? ''),
      ),
    ).toBe(false);
  });

  it('a son paying fills the details box', () => {
    const p = { trip_expenses_paid_by: 'My son Ali Khan' };
    expect(target(p, 'funds_shared')).toBe(YES);
    expect(field(p, 'funds_details')[0]).toMatchObject({
      targetField: '#detailsFunds_txtArea',
      mappedValue: 'Paid for by my son Ali Khan.',
    });
  });

  it('an employer paying names the employer in the details (business visitor)', () => {
    const p = { trip_expenses_paid_by: 'Employer', employer_name: 'Acme Metals' };
    expect(field(p, 'funds_details')[0]?.mappedValue).toBe(
      'Paid for by employer (Acme Metals).',
    );
    const c = {
      trip_expenses_paid_by: 'The Canadian company',
      canadian_business_name: 'Maple Steel Inc.',
    };
    expect(field(c, 'funds_details')[0]?.mappedValue).toBe(
      'Paid for by the Canadian company (Maple Steel Inc.).',
    );
  });

  it('a self-funded trip writes no details', () => {
    expect(field({ trip_expenses_paid_by: 'Pension' }, 'funds_details')).toEqual(
      [],
    );
  });

  it('the interview asks who pays on TRV and super visa, under the business key', () => {
    for (const ctx of [TRV, SUPER, BUSINESS])
      expect(keys(ctx)).toContain('trip_expenses_paid_by');
    expect(asked({}, TRV)).toContain('trip_expenses_paid_by');
    expect(asked({}, SUPER)).toContain('trip_expenses_paid_by');
    expect(asked({ trip_expenses_paid_by: 'Pension' }, SUPER)).not.toContain(
      'trip_expenses_paid_by',
    );
    // The business route keeps its own wording.
    expect(
      intakeFactSpecs(BUSINESS).find((s) => s.key === 'trip_expenses_paid_by')
        ?.question,
    ).toMatch(/your employer, or the Canadian company/);
    for (const ctx of [ETA, EE])
      expect(keys(ctx)).not.toContain('trip_expenses_paid_by');
  });
});

describe('/bio-data-travel-docs: a valid U.S. visa', () => {
  const US = {
    has_valid_us_visa: true,
    us_nonimmigrant_visa_number: 'A1234-567',
    us_nonimmigrant_visa_expiry_date: '2030-06-15',
  };

  it('Yes writes the number and expiry date it reveals', () => {
    expect(target(US, 'holds_us_visa')).toBe('#holdUSVisa_radio-button-01-input');
    expect(field(US, 'us_nonimmigrant_visa_number')[0]).toMatchObject({
      targetField: '#docNumberVisa_input',
      mappedValue: 'A1234567',
    });
    expect(
      field(US, 'us_nonimmigrant_visa_expiry_date').map((m) => [
        m.targetField,
        m.mappedValue,
      ]),
    ).toEqual([
      ['#dateVisaExpiryYear_sltDateYear', '2030'],
      ['#dateVisaExpiryMonth_sltDateMonth', '06'],
      ['#dateVisaExpiryDay_sltDateDay', '15'],
    ]);
    expect(left(US, '/bio-data-travel-docs')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'U.S. visa in another passport' }),
      ]),
    );
  });

  it('No writes nothing it would reveal and adds no note', () => {
    const p = { has_valid_us_visa: false, us_nonimmigrant_visa_number: 'A1234567' };
    expect(target(p, 'holds_us_visa')).toBe('#holdUSVisa_radio-button-02-input');
    expect(field(p, 'us_nonimmigrant_visa_number')).toEqual([]);
    expect(
      left(p, '/bio-data-travel-docs').some(
        (n) => n.label === 'U.S. visa in another passport',
      ),
    ).toBe(false);
  });

  it('the interview asks number and expiry only after a Yes, on tr-rt routes', () => {
    expect(asked({ has_valid_us_visa: true })).toEqual(
      expect.arrayContaining([
        'us_nonimmigrant_visa_number',
        'us_nonimmigrant_visa_expiry_date',
      ]),
    );
    expect(asked({ has_valid_us_visa: false })).not.toContain(
      'us_nonimmigrant_visa_number',
    );
    expect(asked({ has_valid_us_visa: true }, SUPER)).toContain(
      'us_nonimmigrant_visa_expiry_date',
    );
    expect(keys(EE)).not.toContain('us_nonimmigrant_visa_number');
  });
});

describe('/activities: military or police service', () => {
  const note = (p: Record<string, unknown>) =>
    left(p, '/activities').some(
      (n) => n.label === 'Military or police service details',
    );
  it('Yes is written and the service table is left with a note', () => {
    const p = { military_service: true };
    expect(target(p, 'military_service')).toBe('#servedArmy_radio-button-01-input');
    expect(note(p)).toBe(true);
  });
  it('No is written with no note', () => {
    const p = { military_service: false };
    expect(target(p, 'military_service')).toBe('#servedArmy_radio-button-02-input');
    expect(note(p)).toBe(false);
  });
});

describe('/medical-tuberculosis follow-ups', () => {
  it('tested after a contact: Yes reveals the result, written as answered', () => {
    const p = {
      tuberculosis_contact: true,
      tuberculosis_tested: true,
      tuberculosis_test_positive: false,
    };
    expect(target(p, 'tuberculosis_tested')).toBe(
      '#hasTestFiveYears_radio-button-01-input',
    );
    expect(target(p, 'tuberculosis_test_positive')).toBe(
      '#fiveYearsPostive_radio-button-02-input',
    );
    expect(
      target({ ...p, tuberculosis_test_positive: true }, 'tuberculosis_test_positive'),
    ).toBe('#fiveYearsPostive_radio-button-01-input');
  });

  it('a Yes to "tested" with no result asks the applicant', () => {
    const p = { tuberculosis_contact: true, tuberculosis_tested: true };
    expect(left(p, '/medical-tuberculosis')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Tuberculosis — the test result was positive',
          reason: 'needs_your_answer',
        }),
      ]),
    );
  });

  it('not tested: the result is neither written nor listed', () => {
    const p = {
      tuberculosis_contact: true,
      tuberculosis_tested: false,
      tuberculosis_test_positive: true,
    };
    expect(target(p, 'tuberculosis_tested')).toBe(
      '#hasTestFiveYears_radio-button-02-input',
    );
    expect(field(p, 'tuberculosis_test_positive')).toEqual([]);
    expect(
      left(p, '/medical-tuberculosis').some((n) => /positive/.test(n.label)),
    ).toBe(false);
  });

  it('diagnosed: treated for 6 months is written Yes or No', () => {
    const p = { tuberculosis: true, tuberculosis_treated_six_months: true };
    expect(target(p, 'tuberculosis_treated_six_months')).toBe(
      '#treatmentMinSixMonth_radio-button-01-input',
    );
    expect(
      target({ ...p, tuberculosis_treated_six_months: false }, 'tuberculosis_treated_six_months'),
    ).toBe('#treatmentMinSixMonth_radio-button-02-input');
  });

  it('the interview asks each follow-up only after its Yes', () => {
    expect(asked({ tuberculosis: true })).toContain('tuberculosis_treated_six_months');
    expect(asked({ tuberculosis: false })).not.toContain('tuberculosis_treated_six_months');
    expect(asked({ tuberculosis_contact: true })).toContain('tuberculosis_tested');
    expect(asked({ tuberculosis_contact: false })).not.toContain('tuberculosis_tested');
    expect(asked({ tuberculosis_contact: true, tuberculosis_tested: true })).toContain(
      'tuberculosis_test_positive',
    );
    expect(
      asked({ tuberculosis_contact: true, tuberculosis_tested: false }),
    ).not.toContain('tuberculosis_test_positive');
  });
});

describe('/nationality: citizen since birth unticked', () => {
  const ONE = { multiple_citizenship: false };
  it('a naturalised citizen gets the date they became one', () => {
    const p = { ...ONE, citizen_from_birth: false, citizenship_acquired_date: '1990-07-04' };
    expect(field(p, 'citizen_from_birth')).toEqual([]);
    expect(
      field(p, 'ircc_citizenship_date').map((m) => [m.targetField, m.mappedValue]),
    ).toEqual([
      ['#citizenFromYear_sltDateYear', '1990'],
      ['#citizenFromMonth_sltDateMonth', '07'],
      ['#citizenFromDay_sltDateDay', '4'],
    ]);
  });
  it('no date recorded: a note, not a silent blank', () => {
    const p = { ...ONE, citizen_from_birth: false };
    expect(left(p, '/nationality')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Date you became a citizen' }),
      ]),
    );
  });
  it('a citizen since birth ticks the box and is not asked for a date', () => {
    const p = { ...ONE, citizen_from_birth: true, citizenship_acquired_date: '1990-07-04' };
    expect(field(p, 'citizen_from_birth')[0]?.targetField).toBe(
      '#citizenFromBirth_chk-input',
    );
    expect(field(p, 'ircc_citizenship_date')).toEqual([]);
    expect(left(p, '/nationality').some((n) => /became a citizen/.test(n.label))).toBe(false);
    expect(asked({ citizen_from_birth: true })).not.toContain('citizenship_acquired_date');
    expect(asked({ citizen_from_birth: false })).toContain('citizenship_acquired_date');
  });
});

describe('/medical-background-questions: the IME or UMI number', () => {
  it('is asked after a Yes on TRV and super visa, and written', () => {
    for (const ctx of [TRV, SUPER]) {
      expect(asked({ medical_exam_last_12_months: true }, ctx)).toContain(
        'medical_exam_number',
      );
      expect(asked({ medical_exam_last_12_months: false }, ctx)).not.toContain(
        'medical_exam_number',
      );
    }
    const p = { medical_exam_last_12_months: true, medical_exam_number: 'UC12345678' };
    expect(field(p, 'ircc_medical_exam_number')[0]).toMatchObject({
      targetField: '#medicalNumber_input',
      mappedValue: 'UC12345678',
    });
  });
  it('No writes no number', () => {
    const p = { medical_exam_last_12_months: false, medical_exam_number: 'UC12345678' };
    expect(target(p, 'medical_exam_last_12_months')).toBe(
      '#hasMedicalExam_radio-button-02-input',
    );
    expect(field(p, 'ircc_medical_exam_number')).toEqual([]);
  });
});

describe('/contact-info: mailing address the same as home', () => {
  const RADIO = 'mailing_same_as_residential';
  it('is no longer assumed from a home address alone', () => {
    expect(field({}, RADIO)).toEqual([]);
    expect(left({}, '/contact-info')).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'Mailing address' })]),
    );
    expect(asked({})).toContain(RADIO);
  });
  it('Yes is written when the applicant says so', () => {
    const p = { mailing_same_as_residential: true };
    expect(target(p, RADIO)).toBe('#hasDiffAddressContactInfo_radio-button-01-input');
    expect(asked(p)).not.toContain('mailing_address');
  });
  it('No: the mailing address fills the block and the home address the reveal', () => {
    const p = {
      mailing_same_as_residential: false,
      mailing_address: 'PO Box 77, GPO, Lahore 54000, Pakistan',
    };
    expect(asked({ mailing_same_as_residential: false })).toContain('mailing_address');
    const all = inputs(p);
    expect(all.find((m) => m.fieldKey === RADIO)?.targetField).toBe(
      '#hasDiffAddressContactInfo_radio-button-02-input',
    );
    expect(all.find((m) => m.fieldKey === 'mailing_city')?.mappedValue).toBe('Lahore');
    expect(
      all.find(
        (m) => m.targetField === '#city_otherResidentialAddressContactInfo',
      )?.mappedValue,
    ).toBe('Islamabad');
  });
});

describe('/biometrics: re-use or give again', () => {
  const BIO = { biometrics_given: true };
  const radio = (p: Record<string, unknown>) =>
    field({ ...BIO, ...p }, 'biometrics_reuse')[0]?.targetField;
  it('valid through the entry date: re-use', () => {
    expect(radio({ biometrics_valid_until: '2029-03-01' })).toBe(
      '#biometricsAgain_radio-button-3005-input',
    );
  });
  it('expiring before the entry date: give again', () => {
    expect(radio({ biometrics_valid_until: '2027-01-15' })).toBe(
      '#biometricsAgain_radio-button-3004-input',
    );
  });
});

describe('/representative: relationship of an unpaid representative', () => {
  const REP = {
    uses_representative: true,
    representative_paid: false,
    representative_name: 'Bilal Ahmad',
  };
  it('is asked when the representative is not the host, and written', () => {
    expect(asked({ ...REP, host_name: 'Ali Khan' })).toContain(
      'representative_relationship',
    );
    const p = { ...REP, representative_relationship: 'my nephew' };
    expect(field(p, 'ircc_rep_relationship')[0]).toMatchObject({
      targetField: '#unpaidType_select',
      mappedValue: 'Family member',
    });
  });
  it('is not asked of a host representative, a paid one, or with no representative', () => {
    expect(asked({ ...REP, host_name: 'Bilal Ahmad' })).not.toContain(
      'representative_relationship',
    );
    expect(asked({ ...REP, representative_paid: true })).not.toContain(
      'representative_relationship',
    );
    expect(asked({ uses_representative: false })).not.toContain(
      'representative_relationship',
    );
  });
});
