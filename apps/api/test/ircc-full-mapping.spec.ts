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
    // Never asked: "same as home" is no longer assumed (audit 2026-10-19).
    expect(one(page, 'mailing_same_as_residential')).toEqual([]);
    expect(
      one(
        inputs({ ...APPLICANT, mailing_same_as_residential: true }),
        'mailing_same_as_residential',
      )[0],
    ).toMatchObject({
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
      // A new draft shows only "I want to apply for" (live 2026-10-18); the
      // visa purpose needs the host's status, which this applicant lacks.
      '#applyingFor_radio-button-464-input',
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
    // A new draft asks the document type and passport kind first (live
    // 2026-10-18); the ten passport writes then wait for them.
    const travel = on(all, '/bio-data-travel-docs');
    expect(travel).toHaveLength(12);
    expect(travel.slice(0, 2).map((m) => [m.fieldKey, m.targetField])).toEqual([
      ['travel_document_type', '#travelDocument_radio-button-249-input'],
      ['passport_type', '#passportType_radio-button-099-input'],
    ]);
    expect(travel.slice(1).every((m) => m.reveal)).toBe(true);
    // Plain value writes carry no op, so their lock hashes are unchanged.
    expect(on(all, '/bio-data').some((m) => m.op || m.reveal || m.dialog)).toBe(
      false,
    );
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

  it('writes refusal details recorded as a list of refusals (live E2E 2026-10-18)', () => {
    const out = inputs({
      ...APPLICANT,
      refused_or_ordered_to_leave: true,
      refusal_details: [
        {
          country: 'Canada',
          what_was_refused: 'visitor visa',
          month_year: '2023-10',
          reason: 'the purpose of my visit was not consistent with a temporary stay',
        },
        {
          country: 'United States',
          what_was_refused: 'visitor visa',
          month_year: '2024-12',
          reason: 'no reason was given',
        },
      ],
    });
    expect(one(out, 'refusal_details')[0].mappedValue).toBe(
      'Visitor visa refused by Canada in 2023-10. Reason given: the purpose of my visit was not consistent with a temporary stay. ' +
        'Visitor visa refused by United States in 2024-12. No reason was given.',
    );
  });

  it("a dual national's list of nationalities is still not guessed from", () => {
    const p = {
      ...APPLICANT,
      nationality: ['PAK', 'GBR'],
      citizenship: 'India',
      citizenship_country: 'India',
    };
    for (const x of one(inputs(p), 'nationality'))
      expect(String(x.mappedValue)).not.toMatch(/IND|India/);
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
    // Expired before the trip: given again (audit 2026-10-19).
    expect(on(expired, '/biometrics').map((m) => m.targetField)).toEqual([
      '#hasFingerprintsBiometrics_radio-button-01-input',
      '#biometricsAgain_radio-button-3004-input',
    ]);
  });
});

describe('IRCC coverage — what the applicant fills', () => {
  const cov = portalFillCoverage(mapping(), APPLICANT);
  const page = (p: string) => cov.pages.find((x) => x.page === p)!;

  it('lists every recorded page in portal order with a title', () => {
    expect(cov.pages.map((p) => p.page)).toEqual([
      '/group-questions',
      '/purpose',
      '/representative',
      '/bio-data',
      '/bio-data-travel-docs',
      '/nationality',
      '/national-id-doc',
      '/other-names',
      '/contact-info',
      '/minors-guardian',
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
      '/family-info-parents',
      '/language',
      '/contact-info-email',
      '/contact-info-tel',
      '/doc-upload',
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

/**
 * Dry run 2026-10-15: the applicant knew his son's birth YEAR, not the day.
 * IRCC's children dialog accepts that — its month and day selects carry an
 * "Unknown" option — but the mapping demanded a full date and listed the child
 * as "missing: date of birth" for the applicant to add by hand.
 */
describe('IRCC children — a birth year alone is a usable date of birth', () => {
  const SON = {
    name: 'Mian Talha',
    relationship: 'son',
    birth_year: 2000,
    country_of_birth: 'Pakistan',
    same_address: true,
    coming_to_canada: false,
  };
  const withSon = (son: Record<string, unknown>) => ({
    ...APPLICANT,
    children: [son],
  });

  it('writes the year and "Unknown" for month and day', () => {
    const child1 = on(inputs(withSon(SON)), '/family-info-children').filter(
      (m) => m.fieldKey.startsWith('ircc_child_1_'),
    );
    expect(child1[0]).toMatchObject({ op: 'dialog_open' });
    expect(child1[0].mappedValue).toContain('Mian Talha');
    // As IRCC's grid shows it, so a re-run sees the row it added.
    expect(child1[0].mappedValue).toContain('born 2000-**-**)');
    expect(value(child1, 'Child 1 — date of birth — year')).toBe('2000');
    expect(value(child1, 'Child 1 — date of birth — month')).toBe('Unknown');
    expect(value(child1, 'Child 1 — date of birth — day')).toBe('Unknown');
  });

  it('reads a year-only date_of_birth the same way', () => {
    const { birth_year: _y, ...rest } = SON;
    const child1 = on(
      inputs(withSon({ ...rest, date_of_birth: '2000' })),
      '/family-info-children',
    ).filter((m) => m.fieldKey.startsWith('ircc_child_1_'));
    expect(value(child1, 'Child 1 — date of birth — year')).toBe('2000');
    expect(value(child1, 'Child 1 — date of birth — month')).toBe('Unknown');
  });

  it('a full date of birth still wins over the year', () => {
    const child1 = on(
      inputs(withSon({ ...SON, date_of_birth: '2000-05-12' })),
      '/family-info-children',
    ).filter((m) => m.fieldKey.startsWith('ircc_child_1_'));
    expect(value(child1, 'Child 1 — date of birth — month')).toBe('05');
    expect(value(child1, 'Child 1 — date of birth — day')).toBe('12');
  });

  it('the child is no longer listed as missing a date of birth', () => {
    const cov = portalFillCoverage(mapping(), withSon(SON));
    const left = cov.pages.find(
      (p) => p.page === '/family-info-children',
    )!.left;
    expect(left.some((l) => (l.note ?? '').includes('date of birth'))).toBe(
      false,
    );
  });

  it("a child living abroad does not live at the applicant's address", () => {
    const { same_address: _s, ...rest } = SON;
    const child1 = on(
      inputs(
        withSon({
          ...rest,
          in_home_country: false,
          // IRCC will not save the row without where they live (live 2026-10-18).
          address: '45 Main Street, Dubai, United Arab Emirates',
        }),
      ),
      '/family-info-children',
    ).filter((m) => m.fieldKey.startsWith('ircc_child_1_'));
    expect(one(child1, 'ircc_child_1_same_address')[0].targetField).toBe(
      '#hasSameAddress_radio-button-02-input',
    );
  });
});

/**
 * Dry run 2026-10-16 (app 71ad0c29): the profile exactly as prod held it —
 * the host under `family_member_*` / `accommodation_*`, the representative
 * being that host, a home address with no country in it — plus the answers
 * the interview now asks for. Every IRCC page is filled; nothing is left but
 * what no document or answer supplies.
 */
describe('IRCC — every page from documents and intake answers', () => {
  const PROD: Record<string, unknown> = {
    us_green_card: false,
    held_canadian_visa_10_years: false,
    holds_us_visa: false,
    travelling_by_air: true,
    full_name: 'Muzaffar Ahmad',
    applicant_name: 'Muzaffar Ahmad',
    sex: 'M',
    date_of_birth: '1961-06-15',
    applicant_citizenship: 'Pakistani',
    place_of_birth: 'Rawalpindi',
    passport_number: 'AK1182091',
    passport_issue_date: '2023-08-07',
    passport_expiry_date: '2033-08-06',
    passport_type: 'regular',
    national_id_number: '37405-5309209-7',
    national_id_issue_date: '2017-04-24',
    current_country_of_residence: 'Pakistan',
    residential_address: '138 Millat Colony, Rawalpindi 46000',
    purpose_of_visit: 'family visit',
    planned_entry_date: '2027-03-01',
    planned_departure_date: '2027-04-30',
    biometrics_enrollment_date: '2025-06-03',
    biometrics_valid_until: '2035-06-03',
    family_in_destination: true,
    family_member_name: 'Mian Muhammad Bilawal',
    relationship_to_family_in_destination: 'son',
    accommodation_provider_name: 'Mian Muhammad Bilawal',
    accommodation_address: '1202 Stirling Todd Terrace, Milton, ON L9E 2E2',
    uses_representative: true,
    representative_paid: false,
    representative_name: 'Mian Muhammad Bilawal',
    representative_contact: '905-226-5664',
    representative_address:
      '1202 Stirling Todd Terrace, Milton, ON L9E 2E2, Canada',
    available_trip_funds_cad: 30000,
    financial_support: 'son will cover trip costs',
    financial_support_provider_name: 'Mian Muhammad Bilawal',
    retired: true,
    travel_history_countries: [],
    previous_visa_refused: true,
    previous_visa_refusal_date: '2025-06-30',
    previous_visa_refusal_reason: 'IRPR 179(b)',
    removal_orders: false,
    immigration_violations: false,
    tuberculosis: false,
    criminal_charges_or_convictions: false,
    marriage_date: '1988-09-16',
    spouse_name: 'Sumera Ahmad',
    children: [
      {
        name: 'Mian Muhammad Sajawal',
        relationship: 'son',
        date_of_birth: '1989-10-14',
        country_of_birth: 'Pakistan',
      },
      {
        name: 'Mian Muhammad Bilawal',
        relationship: 'son',
        date_of_birth: '1989-10-14',
        country_of_birth: 'Pakistan',
        in_home_country: false,
      },
    ],
    // ── the interview's new questions ──
    country_of_birth: 'Pakistan',
    mailing_same_as_residential: true,
    multiple_citizenship: false,
    citizen_from_birth: true,
    has_other_names: false,
    residence_since: 'since birth',
    marital_status: 'Married',
    has_post_secondary_education: false,
    military_service: false,
    retirement_date: '2016-10',
    committed_crime: false,
    ever_arrested: false,
    violent_organization_member: false,
    ill_treatment: false,
    medical_exam_last_12_months: false,
    tuberculosis_contact: false,
    dialysis: false,
    addiction: false,
    mental_health_condition: false,
    syphilis: false,
    spouse_date_of_birth: '1968-10-09',
    spouse_country_of_birth: 'Pakistan',
    spouse_occupation: 'Homemaker',
    spouse_same_address: true,
    spouse_coming_to_canada: false,
    children_living_with_you: [],
    children_accompanying: 'none',
    parents: [
      {
        name: 'Mian Abdul Rasheed',
        relationship: 'father',
        birth_year: 1935,
        country_of_birth: 'Pakistan',
        occupation: 'Retired',
        same_address: true,
        coming_to_canada: false,
      },
      {
        name: 'Test Mother',
        relationship: 'mother',
        birth_year: 1940,
        country_of_birth: 'Pakistan',
        occupation: 'Homemaker',
        same_address: true,
        coming_to_canada: false,
      },
    ],
    native_language: 'Urdu',
    official_language_ability: 'English',
    email: 'applicant@example.com',
    phone_number: '905-226-5664',
    phone_type: 'cell',
    inviter_phone_type: 'cell',
    inviter_email: 'host@example.com',
    has_second_inviter: false,
    _portal_documents: [
      {
        id: '5ff61570-ccf6-48f1-b03e-36fd7310cd72',
        documentType: 'national_id',
        fileName: 'National_ID.jpg',
        mimeType: 'image/jpeg',
        approved: true,
        createdAt: '2026-10-15T00:00:00Z',
      },
      {
        id: 'a47080eb-48f5-450e-ba77-83204bd68841',
        documentType: 'passport_copy',
        fileName: 'Passport.pdf',
        mimeType: 'application/pdf',
        approved: false,
        createdAt: '2026-10-15T00:00:00Z',
      },
      {
        id: 'cdf447e6-f846-4db3-b1d0-6908d7da881b',
        documentType: 'proof_of_funds',
        fileName: 'Funds.pdf',
        mimeType: 'application/pdf',
        approved: true,
        createdAt: '2026-10-15T00:00:00Z',
      },
      {
        id: '11111111-2222-3333-4444-555555555555',
        documentType: 'imm5476',
        fileName: 'IMM5476.pdf',
        mimeType: 'application/pdf',
        approved: true,
        createdAt: '2026-10-15T00:00:00Z',
      },
    ],
  };
  const cov = portalFillCoverage(mapping(), PROD);
  const all = inputs(PROD);

  it('leaves nothing on any page for the applicant to fill', () => {
    const left = cov.pages
      .filter((p) => p.left.length)
      .map((p) => `${p.page}: ${p.left.map((l) => l.label).join(', ')}`);
    // Live 2026-10-18: the visa purpose turns on the host's status in Canada,
    // and a child who lives elsewhere needs their address. Prod held neither
    // for Sajawal; his brother is the host, whose address is known.
    expect(left).toEqual([
      '/purpose: Why you need a visa',
      '/family-info-children: Child 1',
    ]);
  });

  it('/purpose: a son who is a Canadian citizen is "adult child … citizen or PR" (688)', () => {
    const out = inputs({ ...PROD, inviter_status: 'Canadian citizen' });
    expect(one(out, 'ircc_visa_purpose')[0].targetField).toBe(
      '#visaPurpose_radio-button-688-input',
    );
  });

  it("/family-info-children: the son who is the host gets the host's address", () => {
    const out = inputs(PROD).filter((m) =>
      m.fieldKey.startsWith('ircc_child_2_address'),
    );
    expect(out.map((m) => m.mappedValue)).toEqual(
      expect.arrayContaining([
        '1202',
        'Stirling Todd Terrace',
        'Milton',
        'Ontario',
        'L9E 2E2',
      ]),
    );
  });

  it('/representative: the host who is the representative is a family member', () => {
    const page = on(all, '/representative');
    expect(value(page, 'Representative — relationship to the applicant')).toBe(
      'Family member',
    );
  });

  it('/representative: an explicit relationship wins; an unknown one is left to the applicant', () => {
    const friend = { ...PROD, representative_relationship: 'friend' };
    expect(
      value(
        on(inputs(friend), '/representative'),
        'Representative — relationship to the applicant',
      ),
    ).toBe('Friend');
    const stranger = {
      ...PROD,
      representative_name: 'Someone Else',
      representative_contact: 'someone@example.com',
    };
    expect(
      on(inputs(stranger), '/representative').map((m) => m.label),
    ).not.toContain('Representative — relationship to the applicant');
    expect(
      portalFillCoverage(mapping(), stranger)
        .pages.find((p) => p.page === '/representative')
        ?.left.map((l) => l.label),
    ).toContain('Your relationship to the applicant');
  });

  it('/representative: Yes, then the unpaid representative (the host) from the profile', () => {
    const page = on(all, '/representative');
    expect(one(page, 'uses_representative')[0].mappedValue).toBe('Yes');
    expect(value(page, 'Representative — family name')).toBe('Bilawal');
    expect(value(page, 'Representative — given name')).toBe('Mian Muhammad');
    expect(value(page, 'Representative — telephone type')).toBe('Cellular');
    expect(value(page, 'Representative — telephone number')).toBe('9052265664');
    expect(value(page, 'Representative — city')).toBe('Milton');
    expect(value(page, 'Representative — province')).toBe('Ontario');
    expect(value(page, 'Representative — postal code')).toBe('L9E 2E2');
    expect(value(page, 'Representative — email')).toBe('host@example.com');
  });

  it('/representative: a paid representative gets only "Yes" and a note', () => {
    const paid = { ...PROD, representative_paid: true };
    const page = on(inputs(paid), '/representative');
    expect(page.map((m) => m.fieldKey)).toEqual(['uses_representative']);
    expect(
      portalFillCoverage(mapping(), paid)
        .pages.find((p) => p.page === '/representative')
        ?.left.map((l) => l.label),
    ).toEqual(['Paid representative details']);
  });

  it('/representative: "No" when the applicant uses no representative', () => {
    const none = { ...PROD, uses_representative: false };
    const page = on(inputs(none), '/representative');
    expect(page.map((m) => [m.fieldKey, m.mappedValue])).toEqual([
      ['uses_representative', 'No'],
    ]);
  });

  it('splits a home address that names no country, using the residence country', () => {
    expect(value(all, 'Mailing address — street')).toBe('138 Millat Colony');
    expect(value(all, 'Mailing address — city')).toBe('Rawalpindi');
    expect(value(all, 'Mailing address — postal code')).toBe('46000');
  });

  it('reads the host from the family member being visited, with the representative’s phone', () => {
    expect(value(all, 'Inviter — family name')).toBe('Bilawal');
    expect(value(all, 'Inviter — given name')).toBe('Mian Muhammad');
    expect(value(all, 'Inviter — relationship to you')).toBe('Family member');
    expect(value(all, 'Inviter — city')).toBe('Milton');
    expect(value(all, 'Inviter — telephone number')).toBe('9052265664');
  });

  it('uses the representative’s contact only when the representative is the host', () => {
    const other = inputs({ ...PROD, representative_name: 'Jane Consultant' });
    expect(value(other, 'Inviter — telephone number')).toBeUndefined();
  });

  it('adds the parents, the language answers, the email and the phone', () => {
    expect(on(all, '/family-info-parents').length).toBeGreaterThan(10);
    expect(value(all, 'Native language')).toBe('Urdu');
    expect(value(all, 'Language IRCC should contact you in')).toBe('English');
    expect(value(all, 'Email address')).toBe('applicant@example.com');
    // He lives in Pakistan and wrote the number without +1: it is read as a
    // Pakistani number (code 92) — no longer assumed Canadian (audit
    // 2026-10-18). The readback shows it for him to correct.
    const tel = on(all, '/contact-info-tel');
    expect(one(tel, 'ircc_phone_location')[0].targetField).toBe(
      '#telLocation_telNumContactInfo_radio-button-02-input',
    );
    expect(value(tel, 'Telephone country code')).toBe('92');
    expect(value(tel, 'Telephone number')).toBe('9052265664');
  });

  it('a retirement month is enough for the work history', () => {
    expect(on(all, '/activities').map((m) => m.mappedValue)).toContain('2016');
  });

  it('"since birth" residence starts at the date of birth; nationality from a demonym', () => {
    expect(value(all, 'Living there since — year')).toBe('1961');
    expect(value(all, 'Country of citizenship')).toBeDefined();
  });

  it('children: nobody lives with him or travels; the son in Canada is not at his address', () => {
    expect(on(all, '/family-info-children').length).toBeGreaterThan(10);
  });

  it('a deceased parent needs a date of death, not where they live (live 2026-10-18)', () => {
    const c = portalFillCoverage(mapping(), {
      ...PROD,
      parents: [
        { name: 'Mian Abdul Rasheed', relationship: 'father', deceased: true },
      ],
    });
    const parents = c.pages.find((p) => p.page === '/family-info-parents')!;
    expect(parents.left[0].note).toMatch(/date of death/);
    expect(parents.left[0].note).not.toMatch(/occupation|address|coming/);
  });

  it('a deceased parent with a date of death is written, ticking "deceased"', () => {
    const out = inputs({
      ...PROD,
      parents: [
        {
          name: 'Mian Abdul Rasheed',
          relationship: 'father',
          birth_year: 1935,
          country_of_birth: 'Pakistan',
          deceased: true,
          date_of_death: '2010-02-03',
        },
      ],
    }).filter((m) => m.fieldKey.startsWith('ircc_parent_1_'));
    expect(one(out, 'ircc_parent_1_deceased')[0].targetField).toBe(
      '#isDeathParent_chk-input',
    );
    // A year-only birth date reads as the grid shows it, like a child's.
    expect(
      out.find((m) => m.op === 'dialog_open')?.mappedValue,
    ).toContain('born 1935-**-**)');
    expect(
      out.find((m) => m.fieldKey === 'ircc_parent_1_date_of_death')
        ?.mappedValue,
    ).toBe('2010');
    expect(out.some((m) => m.fieldKey === 'ircc_parent_1_occupation')).toBe(
      false,
    );
  });
});

describe('IRCC gaps closed in the dry run (2026-10-16)', () => {
  it('/bio-data: sex from the passport "M" answers Male', () => {
    const all = inputs({ ...APPLICANT, sex: 'M' });
    expect(one(all, 'sex')[0]).toMatchObject({
      page: '/bio-data',
      mappedValue: 'Male',
    });
    expect(one(inputs({ ...APPLICANT, sex: 'F' }), 'sex')[0].mappedValue).toBe(
      'Female',
    );
    expect(one(inputs({ ...APPLICANT, sex: undefined }), 'sex')).toHaveLength(
      0,
    );
  });

  // Audit 2026-10-18: bilingual passport prints and non-English words.
  it.each([
    ['M/M', 'Male'],
    ['F/F', 'Female'],
    ['M / H', 'Male'],
    ['F / W', 'Female'],
    ['Masculino', 'Male'],
    ['Feminino', 'Female'],
    ['Femenino', 'Female'],
    ['Masculin', 'Male'],
    ['Féminin', 'Female'],
    ['Männlich', 'Male'],
    ['Weiblich', 'Female'],
    ['ذكر', 'Male'],
    ['أنثى', 'Female'],
    ['मर्द', 'Male'],
    ['Masculino / Male', 'Male'],
  ])('/bio-data: sex "%s" answers %s', (sex, want) => {
    expect(one(inputs({ ...APPLICANT, sex }), 'sex')[0]?.mappedValue).toBe(
      want,
    );
  });

  it.each(['M/F', 'H', 'W', 'H/W', 'unknown'])(
    '/bio-data: sex "%s" is left for the applicant',
    (sex) => {
      expect(one(inputs({ ...APPLICANT, sex }), 'sex')).toHaveLength(0);
    },
  );

  it('/validity-status: a refusal with an IRCC application number names Canada', () => {
    const all = inputs({
      ...APPLICANT,
      previous_visa_refused: true,
      denied_entry: false,
      removal_orders: false,
      previous_visa_refusal_date: '2025-06-30',
      previous_visa_application_number: 'V403886015',
      previous_visa_refusal_reason: 'IRPR 179(b)',
    });
    expect(value(all, 'Refusal details')).toMatch(
      /^Visa refused by Canada on 2025-06-30 \(application V403886015\)/,
    );
  });

  it('/finances: the payer who is also the host in Canada is described as such', () => {
    const all = inputs({
      ...APPLICANT,
      financial_supporter: undefined,
      financial_support_provider_name: 'Mian Muhammad Bilawal',
      family_member_name: 'Mian Muhammad Bilawal',
      relationship_to_family_in_destination: 'son',
      family_member_citizenship: 'Canadian',
      accommodation_provider_name: 'Mian Muhammad Bilawal',
      accommodation_address: '1202 Stirling Todd Terrace, Milton, ON L9E 2E2',
      financial_support: 'son will cover trip costs',
    });
    expect(value(on(all, '/finances'), 'Who is giving you money')).toBe(
      'Mian Muhammad Bilawal (son, Canadian citizen) is paying for part or all of the trip and is hosting me at 1202 Stirling Todd Terrace, Milton, ON L9E 2E2. Details: son will cover trip costs.',
    );
  });
});

describe('IRCC travel document page of a new draft (live 2026-10-18)', () => {
  it('chooses Passport and Regular only when VisaAI holds a passport', () => {
    const none = buildMappingInputs(mapping(), {
      ...APPLICANT,
      passport_number: undefined,
    });
    expect(none.some((m) => m.fieldKey === 'travel_document_type')).toBe(false);
    const diplomatic = buildMappingInputs(mapping(), {
      ...APPLICANT,
      passport_type: 'Diplomatic',
    });
    expect(
      diplomatic.find((m) => m.fieldKey === 'travel_document_type')
        ?.mappedValue,
    ).toBe('Passport');
    expect(diplomatic.some((m) => m.fieldKey === 'passport_type')).toBe(false);
  });

  it('a passport type of just "Passport" or "Ordinary" is the regular kind (live 2026-10-18)', () => {
    for (const passport_type of [
      'Passport',
      'Ordinary',
      'P',
      'Regular passport',
    ]) {
      const out = buildMappingInputs(mapping(), {
        ...APPLICANT,
        passport_type,
      });
      expect(out.find((m) => m.fieldKey === 'passport_type')?.mappedValue).toBe(
        'Regular',
      );
      expect(out.some((m) => m.targetField === '#travelDocNum_input')).toBe(
        true,
      );
    }
  });

  it('the four yes/no questions are written only from an explicit answer', () => {
    const keys = [
      'us_green_card',
      'held_canadian_visa_10_years',
      'holds_us_visa',
      'travelling_by_air',
    ];
    const plain = buildMappingInputs(mapping(), APPLICANT).map(
      (m) => m.fieldKey,
    );
    for (const k of keys) expect(plain).not.toContain(k);
    const said = buildMappingInputs(mapping(), {
      ...APPLICANT,
      us_green_card: 'no',
      held_canadian_visa_10_years: 'no',
      holds_us_visa: 'no',
      travelling_by_air: 'yes',
    });
    expect(
      said.filter((m) => keys.includes(m.fieldKey)).map((m) => m.targetField),
    ).toEqual([
      '#hasGreenCard_radio-button-02-input',
      '#travelledToCanadaInPastTen_radio-button-02-input',
      '#holdUSVisa_radio-button-02-input',
      '#travellingByAir_radio-button-01-input',
    ]);
  });
});

describe('IRCC telephones — applicants from every country (audit 2026-10-18)', () => {
  const tel = (p: Record<string, unknown>) =>
    on(inputs({ ...APPLICANT, phone_type: 'cell', ...p }), '/contact-info-tel');
  const fields = (rows: PreflightMappingInput[]) =>
    rows
      .filter((m) => m.op !== 'dialog_open' && m.op !== 'dialog_save')
      .map((m) => [m.targetField, m.mappedValue]);

  it('a Pakistani mobile with +92: "Other", code 92, the national number', () => {
    expect(fields(tel({ phone_number: '+92 300 1234567' }))).toEqual([
      ['#telType_telNumContactInfo_radio-button-02-input', 'Cellular'],
      ['#telLocation_telNumContactInfo_radio-button-02-input', 'Other'],
      ['#telCountryCode_telNumContactInfo', '92'],
      ['#telNumber_telNumContactInfo', '3001234567'],
    ]);
  });

  it('a number with its trunk 0 and no code takes the residence country (India)', () => {
    const rows = tel({
      phone_number: '09876543210',
      residential_address: '12 MG Road, Bengaluru 560001, India',
    });
    expect(value(rows, 'Telephone location')).toBe('Other');
    expect(value(rows, 'Telephone country code')).toBe('91');
    expect(value(rows, 'Telephone number')).toBe('9876543210');
  });

  it.each([
    ['India', '9876543210', '91', '9876543210'],
    ['Mexico', '5512345678', '52', '5512345678'],
    ['Vietnam', '0912345678', '84', '912345678'],
    ['China', '13812345678', '86', '13812345678'],
    ['Brazil', '(11) 98765-4321', '55', '11987654321'],
  ])(
    '%s: %s is never typed in as a Canada / US number',
    (country, raw, code, number) => {
      const rows = tel({
        phone_number: raw,
        residential_address: undefined,
        country_of_residence: country,
      });
      expect(value(rows, 'Telephone location')).toBe('Other');
      expect(value(rows, 'Telephone country code')).toBe(code);
      expect(value(rows, 'Telephone number')).toBe(number);
      expect(rows.map((m) => m.fieldKey)).not.toContain('ircc_phone_number');
    },
  );

  it('a North American number: explicit +1, or the NANP shape for a US resident', () => {
    expect(
      value(tel({ phone_number: '+1 905-226-5664' }), 'Telephone location'),
    ).toBe('Canada or the U.S.');
    const us = tel({
      phone_number: '(212) 555-0142',
      residential_address: undefined,
      country_of_residence: 'United States',
    });
    expect(fields(us).slice(1)).toEqual([
      [
        '#telLocation_telNumContactInfo_radio-button-01-input',
        'Canada or the U.S.',
      ],
      ['#telNumber_telNumContactInfo', '2125550142'],
    ]);
  });

  it('the Forms page’s separate country code counts as the prefix', () => {
    const rows = tel({ telephone: '9052265664', telephone_country_code: '1' });
    expect(value(rows, 'Telephone location')).toBe('Canada or the U.S.');
    expect(value(rows, 'Telephone number')).toBe('9052265664');
  });

  it('neither a prefix nor a country: never guessed, left for the applicant', () => {
    const rows = tel({
      phone_number: '9876543210',
      residential_address: undefined,
    });
    expect(rows).toEqual([]);
    const left = portalFillCoverage(mapping(), {
      ...APPLICANT,
      phone_type: 'cell',
      phone_number: '9876543210',
      residential_address: undefined,
    }).pages.find((p) => p.page === '/contact-info-tel')?.left;
    expect(left?.map((l) => [l.label, l.reason])).toEqual([
      ['Telephone number', 'fill_yourself'],
    ]);
  });

  it("the inviter's number back home (+92) goes in as Other", () => {
    const page = on(
      inputs({ ...APPLICANT, host_phone: '0092 (0)51 1234567' }),
      '/inviter-info',
    );
    expect(one(page, 'inviter_phone_location')[0].targetField).toBe(
      '#telLocation_phoneNumberInviter_radio-button-02-input',
    );
    expect(value(page, 'Inviter — telephone country code')).toBe('92');
    expect(value(page, 'Inviter — telephone number')).toBe('511234567');
    expect(one(page, 'inviter_phone')).toEqual([]);
  });

  it('a host in Canada: an unprefixed North American number is theirs', () => {
    const page = on(
      inputs({ ...APPLICANT, host_phone: '416 555 0199' }),
      '/inviter-info',
    );
    expect(value(page, 'Inviter — telephone number')).toBe('4165550199');
    expect(one(page, 'inviter_phone_international')).toEqual([]);
  });

  it('a representative who is not the host, with no address: only a +CC number is placed', () => {
    const rep = {
      ...APPLICANT,
      uses_representative: true,
      representative_paid: false,
      representative_name: 'Omar Farooq',
      representative_relationship: 'friend',
    };
    const page = (contact: string) =>
      on(
        inputs({ ...rep, representative_contact: contact }),
        '/representative',
      );
    expect(
      page('5512345678').some((m) => /telephone/.test(m.label ?? '')),
    ).toBe(false);
    const intl = page('+52 55 1234 5678');
    expect(value(intl, 'Representative — telephone location')).toBe('Other');
    expect(value(intl, 'Representative — telephone country code')).toBe('52');
    expect(value(intl, 'Representative — telephone number')).toBe('5512345678');
  });
});

describe('IRCC names — as the passport prints them (audit 2026-10-18)', () => {
  const bio = (p: Record<string, unknown>) =>
    on(inputs(p), '/bio-data').filter((m) =>
      ['#lastName_input', '#firstName_input'].includes(m.targetField),
    );
  const base: Record<string, unknown> = { ...APPLICANT };
  delete base.given_name;
  delete base.family_name;
  const bioLeft = (p: Record<string, unknown>) =>
    portalFillCoverage(mapping(), p)
      .pages.find((x) => x.page === '/bio-data')
      ?.left.map((l) => l.label);

  it('two-word given and family names are kept whole', () => {
    expect(
      bio({
        ...base,
        full_name: 'MARIA JOSE GARCIA LOPEZ',
        given_name: 'MARIA JOSE',
        family_name: 'GARCIA LOPEZ',
      }).map((m) => [m.targetField, m.mappedValue]),
    ).toEqual([
      ['#lastName_input', 'GARCIA LOPEZ'],
      ['#firstName_input', 'MARIA JOSE'],
    ]);
  });

  it('a single name is the family name; the blank given name is not "missing"', () => {
    for (const p of [
      { ...base, full_name: 'SUKARNO' },
      { ...base, full_name: 'SUKARNO', family_name: 'SUKARNO' },
    ]) {
      expect(bio(p).map((m) => [m.targetField, m.mappedValue])).toEqual([
        ['#lastName_input', 'SUKARNO'],
      ]);
      expect(bioLeft(p)).not.toContain('Given name');
    }
  });

  it('a given name that is truly unknown is still listed', () => {
    expect(bioLeft({ ...base, family_name: 'Khan' })).toContain('Given name');
  });
});
