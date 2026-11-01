/**
 * The whole IRCC tr-rt visitor application, page by page, from the selectors
 * recorded live on 2026-10-15 (the pages a human filled by hand in that day's
 * dry run). The applicant below is modelled on that dry run: a retired
 * Pakistani visiting his son in Toronto.
 */
import '../src/modules/automation/portal-fills/canada-ircc'; // registers 'ircc'
import type { PreflightMappingInput } from '@visaai/types';
import {
  applyPrefillOverrides,
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import { resolvePortalFill } from '../src/strategies/portal-integration/portal-fill.registry';

const mapping = () => resolvePortalFill('ircc')!;

const APPLICANT: Record<string, unknown> = {
  given_name: 'Muhammad',
  family_name: 'Khan',
  date_of_birth: '1958-03-09',
  nationality: 'PAK',
  passport_number: 'AB1234567',
  passport_issue_date: '2022-01-10',
  passport_expiry_date: '2032-01-09',
  place_of_birth: 'Rawalpindi, Pakistan',
  national_id_number: '37405-5309209-7',
  national_id_issue_date: '2019-05-02',
  residential_address:
    'House 12, Street 5, Sector F-7, Islamabad 44000, Pakistan',
  purpose_of_visit: 'Family visit',
  planned_entry_date: '2026-12-01',
  planned_departure_date: '2027-01-31',
  marital_status: 'Married',
  spouse_name: 'Ayesha Khan',
  marriage_date: '1985-11-20',
  children: [
    {
      name: 'Ali Khan',
      relationship: 'son',
      date_of_birth: '1988-04-01',
      country_of_birth: 'Pakistan',
      same_address: false,
      coming_to_canada: false,
    },
    { name: 'Sara Khan', relationship: 'daughter' },
  ],
  host_name: 'Ali Khan',
  host_relationship: 'son',
  host_address: '123 Main St, Apt 4, Toronto, ON M5V 2T6',
  host_phone: '+1 (416) 555-0199',
  host_email: 'ali@example.com',
  available_trip_funds_cad: '5,000',
  financial_supporter: 'Ali Khan',
  financial_supporter_relationship: 'son',
  retired: true,
  retirement_date: '2018-03-31',
  travel_history: [],
};

const inputs = (p: Record<string, unknown>, exclude?: Set<string>) =>
  buildMappingInputs(mapping(), p, exclude);
const on = (all: PreflightMappingInput[], page: string) =>
  all.filter((m) => m.page === page);
const one = (all: PreflightMappingInput[], key: string) =>
  all.filter((m) => m.fieldKey === key);
const value = (all: PreflightMappingInput[], label: string) =>
  all.find((m) => m.label === label)?.mappedValue;

describe('IRCC full mapping — the dry-run applicant', () => {
  const all = inputs(APPLICANT);

  it('/nationality: country and city of birth from the place of birth', () => {
    const page = on(all, '/nationality');
    expect(value(page, 'Country of birth')).toBe('209');
    expect(one(page, 'birth_country')[0].targetField).toBe(
      '#countryBirth_select',
    );
    expect(value(page, 'City of birth')).toBe('Rawalpindi');
    // "More than one citizenship?" was never asked: left, and so is what it reveals.
    expect(one(page, 'multiple_citizenship')).toEqual([]);
    expect(one(page, 'citizenship_country')).toEqual([]);
  });

  it('/national-id-doc: answers Yes, then the CNIC without dashes, issue date and country', () => {
    const page = on(all, '/national-id-doc');
    expect(page[0]).toMatchObject({
      fieldKey: 'has_national_id',
      targetField: '#hasNationality_radio-button-01-input',
      mappedValue: 'Yes',
      op: 'radio',
    });
    const num = one(page, 'national_id_number');
    expect(num.map((m) => m.targetField)).toEqual([
      '#docNumberNationalities_input',
      '#docNumberConfirmationNationalities_input',
    ]);
    expect(
      num.every((m) => m.mappedValue === '3740553092097' && m.reveal),
    ).toBe(true);
    expect(
      one(page, 'national_id_issue_date').map((m) => m.mappedValue),
    ).toEqual(['2019', '05', '2']);
    expect(one(page, 'national_id_issue_date')[0].targetField).toBe(
      '#dateIssueNationalitiesYear_sltDateYear',
    );
    expect(value(page, 'Country of issue')).toBe('209');
  });

  it('/contact-info: the home address split into street, city and postal code', () => {
    const page = on(all, '/contact-info');
    expect(value(page, 'Mailing address — country')).toBe('209');
    expect(value(page, 'Mailing address — street')).toBe(
      'House 12, Street 5, Sector F-7',
    );
    expect(value(page, 'Mailing address — city')).toBe('Islamabad');
    expect(value(page, 'Mailing address — postal code')).toBe('44000');
    expect(one(page, 'mailing_same_as_residential')[0]).toMatchObject({
      targetField: '#hasDiffAddressContactInfo_radio-button-01-input',
      mappedValue: 'Yes',
    });
    // No "living there since" date: the residence row is not added at all.
    expect(page.some((m) => m.op === 'dialog_open')).toBe(false);
  });

  it('/inviter-info: the son in Toronto, address typed manually', () => {
    const page = on(all, '/inviter-info');
    expect(value(page, 'Inviter — family name')).toBe('Khan');
    expect(value(page, 'Inviter — given name')).toBe('Ali');
    expect(one(page, 'inviter_relationship')[0]).toMatchObject({
      op: 'select_text',
      mappedValue: 'Family member',
    });
    expect(one(page, 'inviter_manual_address')[0]).toMatchObject({
      op: 'check',
      targetField: '#manualEntryaddress_inviterAddress-input',
    });
    expect(value(page, 'Inviter — street number')).toBe('123');
    expect(value(page, 'Inviter — street')).toBe('Main St');
    expect(value(page, 'Inviter — apartment / unit')).toBe('4');
    expect(value(page, 'Inviter — city')).toBe('Toronto');
    expect(value(page, 'Inviter — province')).toBe('Ontario');
    expect(value(page, 'Inviter — postal code')).toBe('M5V 2T6');
    expect(one(page, 'inviter_phone_location')[0].targetField).toBe(
      '#telLocation_phoneNumberInviter_radio-button-01-input',
    );
    expect(value(page, 'Inviter — telephone number')).toBe('4165550199');
    expect(value(page, 'Inviter — email')).toBe('ali@example.com');
    // Telephone type and a second inviter were never asked.
    expect(one(page, 'inviter_phone_type')).toEqual([]);
    expect(one(page, 'has_second_inviter')).toEqual([]);
  });

  it('/finances: whole dollars, and who is paying', () => {
    const page = on(all, '/finances');
    expect(value(page, 'Money available for the trip (CAD)')).toBe('5000');
    expect(one(page, 'funds_shared')[0].mappedValue).toBe('Yes');
    expect(value(page, 'Who is giving you money')).toBe(
      'Ali Khan (son) is paying for part or all of the trip.',
    );
  });

  it('/activities: a retirement row through the work-history dialog, in order', () => {
    const page = on(all, '/activities');
    const keys = page.map((m) => m.fieldKey);
    expect(keys[0]).toBe('ircc_work_retired_row');
    expect(keys[keys.length - 1]).toBe('ircc_work_retired_row_saved');
    expect(page[0]).toMatchObject({
      op: 'dialog_open',
      targetField: '#empHistoryTable_add_button',
    });
    expect(page[page.length - 1]).toMatchObject({
      op: 'dialog_save',
      targetField: '::dialog-save',
      dialog: true,
    });
    expect(
      one(page, 'ircc_work_retired_from').map((m) => [
        m.targetField,
        m.mappedValue,
      ]),
    ).toEqual([
      ['#fromWorkYear_sltDateYear', '2018'],
      ['#fromWorkMonth_sltDateMonth', '03'],
    ]);
    expect(one(page, 'ircc_work_retired_activity')[0]).toMatchObject({
      op: 'select_text',
      mappedValue: 'Retired',
      dialog: true,
    });
    expect(one(page, 'ircc_work_retired_ongoing')[0]).toMatchObject({
      op: 'check',
      dialog: true,
    });
    // Education and military service were never asked.
    expect(one(page, 'has_post_secondary_education')).toEqual([]);
    expect(one(page, 'military_service')).toEqual([]);
  });

  it('/travel-history: "No" from an explicitly empty travel history', () => {
    expect(one(all, 'travelled_last_5_years')[0]).toMatchObject({
      targetField: '#traveledToOtherCountries_radio-button-02-input',
      mappedValue: 'No',
    });
  });

  it('/family-info: married, date of marriage, spouse name; spouse DOB left (not recorded)', () => {
    const page = on(all, '/family-info');
    expect(page[0]).toMatchObject({
      fieldKey: 'marital_status',
      targetField: '#currentMaritalStatus_radio-button-01-input',
      mappedValue: 'Married',
    });
    expect(one(page, 'marriage_date').map((m) => m.mappedValue)).toEqual([
      '1985',
      '11',
      '20',
    ]);
    expect(one(page, 'marriage_date')[0].targetField).toBe(
      '#dateOfDatingYear_sltDateYear',
    );
    expect(one(page, 'spouse_family_name')[0]).toMatchObject({
      targetField: '#lastName_input',
      mappedValue: 'Khan',
      reveal: true,
    });
    expect(one(page, 'spouse_given_name')[0].mappedValue).toBe('Ayesha');
    expect(one(page, 'spouse_date_of_birth')).toEqual([]);
  });

  it('/family-info-children: Yes; the complete child is added in a dialog, the incomplete one is not', () => {
    const page = on(all, '/family-info-children');
    expect(page[0]).toMatchObject({
      fieldKey: 'has_children',
      mappedValue: 'Yes',
      targetField: '#hasChild_radio-button-01-input',
    });
    const child1 = page.filter((m) => m.fieldKey.startsWith('ircc_child_1_'));
    expect(child1[0]).toMatchObject({
      op: 'dialog_open',
      reveal: true,
      mappedValue: 'Ali Khan (Son, born 1988-04-01)',
    });
    expect(child1.slice(1).every((m) => m.dialog)).toBe(true);
    expect(value(child1, 'Child 1 — family name')).toBe('Khan');
    expect(value(child1, 'Child 1 — given name')).toBe('Ali');
    expect(value(child1, 'Child 1 — relationship')).toBe('Son');
    expect(value(child1, 'Child 1 — country of birth')).toBe('209');
    expect(one(child1, 'ircc_child_1_same_address')[0].targetField).toBe(
      '#hasSameAddress_radio-button-02-input',
    );
    expect(one(child1, 'ircc_child_1_coming_to_canada')[0].targetField).toBe(
      '#childComingCanada_radio-button-02-input',
    );
    expect(child1[child1.length - 1]).toMatchObject({ op: 'dialog_save' });
    expect(page.some((m) => m.fieldKey.startsWith('ircc_child_2_'))).toBe(
      false,
    );
  });

  it('answers no legal declaration the applicant did not give', () => {
    for (const page of [
      '/validity-status',
      '/crime-activity',
      '/security-questions',
      '/medical-background-questions',
      '/medical-tuberculosis',
      '/medical-questions',
    ])
      expect(on(all, page)).toEqual([]);
  });

  it('keeps the first three pages exactly as before', () => {
    expect(on(all, '/purpose').map((m) => m.targetField)).toEqual([
      '#visitDetails_txtArea',
      '#dateComingToCanadaYear_sltDateYear',
      '#dateComingToCanadaMonth_sltDateMonth',
      '#dateComingToCanadaDay_sltDateDay',
      '#dateComingToCanadaToYear_sltDateYear',
      '#dateComingToCanadaToMonth_sltDateMonth',
      '#dateComingToCanadaToDay_sltDateDay',
    ]);
    expect(
      on(all, '/bio-data').map((m) => [m.fieldKey, m.targetField]),
    ).toEqual([
      ['family_name', '#lastName_input'],
      ['given_name', '#firstName_input'],
      ['date_of_birth', '#year_sltDateYear'],
      ['date_of_birth', '#month_sltDateMonth'],
      ['date_of_birth', '#day_sltDateDay'],
    ]);
    expect(on(all, '/bio-data-travel-docs')).toHaveLength(10);
    // Plain value writes carry no op, so their lock hashes are unchanged.
    expect(
      [
        ...on(all, '/purpose'),
        ...on(all, '/bio-data'),
        ...on(all, '/bio-data-travel-docs'),
      ].some((m) => m.op || m.reveal || m.dialog),
    ).toBe(false);
  });
});

describe('IRCC legal declarations — explicit answers only', () => {
  const DECLARED = {
    ...APPLICANT,
    immigration_violations: false,
    previous_visa_refused: false,
    denied_entry: false,
    removal_orders: false,
    criminal_charges_or_convictions: false,
    member_of_violent_organization: false,
    ill_treatment: 'No',
    medical_exam_last_12_months: false,
    tuberculosis: false,
    dialysis: false,
    addiction: 'no',
    mental_health_condition: false,
    syphilis: false,
  };
  const all = inputs(DECLARED);

  it('answers each declared question "No", flagged as a declaration', () => {
    const declared = all.filter((m) => m.declaration);
    expect(declared.map((m) => [m.fieldKey, m.mappedValue])).toEqual([
      ['immigration_violations', 'No'],
      ['refused_or_ordered_to_leave', 'No'],
      ['ever_charged', 'No'],
      ['ever_convicted', 'No'],
      ['violent_organization_member', 'No'],
      ['ill_treatment', 'No'],
      ['medical_exam_last_12_months', 'No'],
      ['tuberculosis', 'No'],
      ['dialysis', 'No'],
      ['addiction', 'No'],
      ['mental_health_condition', 'No'],
      ['syphilis', 'No'],
    ]);
    expect(
      declared.every(
        (m) =>
          m.op === 'radio' && /_radio-button-02-input$/.test(m.targetField),
      ),
    ).toBe(true);
  });

  it('"no charges or convictions" does not answer "committed" or "arrested"', () => {
    expect(one(all, 'committed_crime')).toEqual([]);
    expect(one(all, 'ever_arrested')).toEqual([]);
    const cov = portalFillCoverage(mapping(), DECLARED).pages.find(
      (p) => p.page === '/crime-activity',
    )!;
    expect(cov.left).toEqual([
      expect.objectContaining({
        reason: 'needs_your_answer',
        label: expect.stringContaining('committed'),
      }),
      expect.objectContaining({
        reason: 'needs_your_answer',
        label: expect.stringContaining('arrested'),
      }),
    ]);
  });

  it('TB close contact and military service are never inferred', () => {
    expect(one(all, 'tuberculosis_contact')).toEqual([]);
    expect(one(all, 'military_service')).toEqual([]);
  });

  it('an ongoing-condition answer does not answer the specific medical questions', () => {
    const p = { ...APPLICANT, ongoing_medical_condition: false };
    expect(on(inputs(p), '/medical-questions')).toEqual([]);
  });

  it('refused / denied entry / ordered to leave: "No" needs all three, "Yes" needs any one', () => {
    const onlyRefused = { ...APPLICANT, previous_visa_refused: false };
    expect(one(inputs(onlyRefused), 'refused_or_ordered_to_leave')).toEqual([]);
    const yes = {
      ...APPLICANT,
      previous_visa_refused: true,
      previous_visa_refusal_country: 'United Kingdom',
      previous_visa_refusal_date: '2015-06-01',
      previous_visa_refusal_number: 'GWF123',
      previous_visa_refusal_reason: 'insufficient funds',
    };
    const out = inputs(yes);
    expect(one(out, 'refused_or_ordered_to_leave')[0]).toMatchObject({
      mappedValue: 'Yes',
      targetField: '#refusedVisaInOtherCountry_radio-button-01-input',
    });
    expect(one(out, 'refusal_details')[0]).toMatchObject({
      targetField: '#refusedVisaInOtherCountryDetails_txtArea',
      mappedValue:
        'Visa refused by United Kingdom on 2015-06-01 (application GWF123). Reason given: insufficient funds.',
      reveal: true,
      declaration: true,
    });
  });

  it('never writes more than 500 characters into the refusal details', () => {
    const long = {
      ...APPLICANT,
      previous_visa_refused: true,
      refusal_details: 'x '.repeat(260),
    };
    expect(one(inputs(long), 'refusal_details')).toEqual([]);
    const cov = portalFillCoverage(mapping(), long).pages.find(
      (p) => p.page === '/validity-status',
    )!;
    expect(cov.left).toContainEqual(
      expect.objectContaining({
        label: 'Refusal details',
        reason: 'fill_yourself',
        note: expect.stringContaining('500 characters'),
      }),
    );
  });

  it('a "yes" is written as Yes, never softened', () => {
    expect(
      one(inputs({ ...APPLICANT, tuberculosis: 'yes' }), 'tuberculosis')[0],
    ).toMatchObject({
      mappedValue: 'Yes',
      targetField: '#hasTuberculosis_radio-button-01-input',
    });
  });

  it("a declaration on the saved form counts only when it is the applicant's own", () => {
    const form = (
      source: 'inferred' | 'consultant' | 'profile' | 'applicant' | undefined,
    ) => [
      {
        key: 'tuberculosis',
        label: 'TB',
        value: 'No',
        ...(source ? { source } : {}),
      },
    ];
    const answered = (source: Parameters<typeof form>[0]) =>
      one(
        inputs(applyPrefillOverrides(mapping(), APPLICANT, form(source))),
        'tuberculosis',
      );
    expect(answered('inferred')).toEqual([]);
    expect(answered('consultant')).toEqual([]);
    expect(answered(undefined)).toEqual([]);
    expect(answered('profile')[0]?.mappedValue).toBe('No');
    expect(answered('applicant')[0]?.mappedValue).toBe('No');
  });

  it('a non yes/no value is not an answer', () => {
    expect(
      one(inputs({ ...APPLICANT, tuberculosis: 'not sure' }), 'tuberculosis'),
    ).toEqual([]);
  });
});

describe('IRCC follow-ups hang off their parent answer', () => {
  it('a follow-up is not written when its parent is marked not applicable', () => {
    const out = inputs(APPLICANT, new Set(['has_national_id']));
    expect(on(out, '/national-id-doc')).toEqual([]);
  });

  it('"No" to the national ID question reveals nothing', () => {
    const out = inputs({ ...APPLICANT, has_national_id: false });
    expect(
      on(out, '/national-id-doc').map((m) => [m.fieldKey, m.mappedValue]),
    ).toEqual([['has_national_id', 'No']]);
  });

  it('a single citizenship reveals the country of citizenship', () => {
    const out = on(
      inputs({ ...APPLICANT, dual_citizenship: false }),
      '/nationality',
    );
    expect(one(out, 'multiple_citizenship')[0].mappedValue).toBe('No');
    expect(one(out, 'citizenship_country')[0]).toMatchObject({
      mappedValue: '209',
      reveal: true,
    });
    // "citizen since birth" only from the applicant's own answer.
    expect(one(out, 'citizen_from_birth')).toEqual([]);
  });

  it('valid biometrics are re-used only while they cover the entry date', () => {
    const ok = inputs({
      ...APPLICANT,
      biometrics_enrollment_date: '2019-01-01',
      biometrics_valid_until: '2029-01-01',
    });
    expect(on(ok, '/biometrics').map((m) => m.targetField)).toEqual([
      '#hasFingerprintsBiometrics_radio-button-01-input',
      '#biometricsAgain_radio-button-3005-input',
    ]);
    const expired = inputs({
      ...APPLICANT,
      biometrics_enrollment_date: '2015-01-01',
      biometrics_valid_until: '2025-01-01',
    });
    expect(on(expired, '/biometrics').map((m) => m.fieldKey)).toEqual([
      'biometrics_given',
    ]);
  });
});

describe('IRCC coverage — what the applicant fills', () => {
  const cov = portalFillCoverage(mapping(), APPLICANT);
  const page = (p: string) => cov.pages.find((x) => x.page === p)!;

  it('lists every recorded page in portal order with a title', () => {
    expect(cov.pages.map((p) => p.page)).toEqual([
      '/purpose',
      '/bio-data',
      '/bio-data-travel-docs',
      '/nationality',
      '/national-id-doc',
      '/other-names',
      '/contact-info',
      '/biometrics',
      '/inviter-info',
      '/finances',
      '/activities',
      '/travel-history',
      '/validity-status',
      '/crime-activity',
      '/security-questions',
      '/medical-background-questions',
      '/medical-tuberculosis',
      '/medical-questions',
      '/family-info',
      '/family-info-children',
    ]);
    expect(page('/national-id-doc').title).toBe('National identity document');
    expect(page('/national-id-doc').filled).toBe(7);
  });

  it('declarations without an answer are "needs your answer"', () => {
    for (const p of [
      '/crime-activity',
      '/security-questions',
      '/medical-tuberculosis',
      '/medical-questions',
    ])
      expect(page(p).left.length).toBeGreaterThan(0);
    expect(
      page('/medical-tuberculosis').left.every(
        (l) => l.reason === 'needs_your_answer',
      ),
    ).toBe(true);
    expect(page('/activities').left).toContainEqual(
      expect.objectContaining({
        label: 'Served in a military, militia or civil defence unit',
        reason: 'needs_your_answer',
      }),
    );
    expect(page('/validity-status').left).toContainEqual(
      expect.objectContaining({
        reason: 'needs_your_answer',
        label: expect.stringContaining('refused a visa'),
      }),
    );
  });

  it('missing facts are "not in your VisaAI data", with what is missing', () => {
    expect(page('/family-info').left).toContainEqual(
      expect.objectContaining({
        label: 'Spouse — date of birth',
        reason: 'not_in_profile',
      }),
    );
    expect(page('/family-info-children').left).toContainEqual(
      expect.objectContaining({
        label: 'Child 2',
        reason: 'not_in_profile',
        note: expect.stringContaining('date of birth'),
      }),
    );
    // A date split into three selects is one item, not three.
    expect(
      page('/family-info').left.filter((l) =>
        l.label.startsWith('Spouse — date of birth'),
      ),
    ).toHaveLength(1);
  });

  it('does not list follow-ups whose question was not answered', () => {
    expect(page('/nationality').left.map((l) => l.label)).toEqual([
      'Citizen of more than one country',
    ]);
  });
});
