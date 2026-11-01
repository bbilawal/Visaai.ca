import { PDFDocument } from 'pdf-lib';
import { imm1294Answers, renderImm1294 } from './imm1294';
import { isOfficialFormSupported, tryRenderOfficialForm } from './index';
import { preparedFormNote } from '../../../strategies/form-mapping/prepared-forms';

/**
 * A study-permit applicant shaped like the live study route's profile, with
 * fictional details (no real person's data).
 */
const PROFILE = {
  family_name: 'Rahimov',
  given_name: 'Tariq Ali',
  date_of_birth: '2001-04-09',
  sex: 'Male',
  city_of_birth: 'Lahore',
  country_of_birth: 'Pakistan',
  nationality: 'Pakistan',
  country_of_residence: 'Pakistan',
  residence_since: 'since birth',
  previous_countries_of_residence: [
    {
      country: 'United Arab Emirates',
      status: 'Worker',
      from: '2021-02',
      to: '2022-01',
    },
  ],
  marital_status: 'Married',
  marriage_date: '2024-12-01',
  spouse_name: 'Rahimova, Sana',
  has_other_names: 'no',
  native_language: 'Urdu',
  official_language_ability: 'English',
  preferred_contact_language: 'english',
  language_test_type: 'IELTS Academic',
  passport_number: 'ZZ0000001',
  passport_country: 'Pakistan',
  passport_issue_date: '2022-03-01',
  passport_expiry_date: '2032-02-28',
  has_national_id: 'yes',
  national_id_number: '00000-0000000-0',
  us_permanent_resident: false,
  residential_address: 'House 1, Street 2, Model Town, Lahore 54000, Pakistan',
  mailing_same_as_residential: 'yes',
  email: 'student@example.com',
  phone_number: '+92 300 0000000',
  study_school_name: 'Example College of Applied Arts',
  dli_number: 'O000000000000',
  study_program: 'Business Analytics',
  study_level: 'Post-graduate certificate',
  study_field: 'Business',
  study_province: 'Ontario',
  study_city: 'Toronto',
  school_address: '1 Example Road, Toronto, ON M0M 0M0',
  student_id_number: 'none',
  study_start_date: '2027-01-08',
  study_end_date: '2027-12-15',
  tuition_cad: '18500',
  room_and_board_cad: '14000',
  study_funds_available_cad: '42000',
  study_expenses_paid_by: 'Myself and my father',
  has_attestation_letter: 'yes',
  attestation_letter_number: 'ON-PAL-0000001',
  has_post_secondary_education: 'yes',
  education_history: [
    {
      school: 'Example University',
      city: 'Lahore',
      country: 'Pakistan',
      from: '2019-09',
      to: '2023-06',
      level: "Bachelor's",
      field_of_study: 'Commerce',
    },
  ],
  work_history: [
    {
      from: '2021-02',
      to: '2022-01',
      activity: 'Sales assistant',
      employer: 'Example Trading LLC',
      city: 'Dubai',
      country: 'United Arab Emirates',
    },
    {
      from: '2023-07',
      to: 'present',
      activity: 'Accounts officer',
      employer: 'Example Textiles',
      city: 'Lahore',
      country: 'Pakistan',
    },
  ],
  tuberculosis_contact: 'no',
  tuberculosis: 'no',
  health_services_disorder: 'no',
  immigration_violations: 'no',
  refused_or_ordered_to_leave: 'yes',
  refusal_details: [
    {
      country: 'United Kingdom',
      what_was_refused: 'visitor visa',
      month_year: '2020-05',
      reason: 'funds',
    },
  ],
  previous_canada_application: 'no',
  committed_crime: 'no',
  ever_arrested: 'no',
  ever_charged: 'no',
  ever_convicted: 'no',
  military_service: 'no',
  violent_organization_member: 'no',
  ill_treatment: 'no',
};

const val = (
  a: ReturnType<typeof imm1294Answers>,
  section: string,
  label: string | RegExp,
) =>
  a.lines.find(
    (l) =>
      l.section === section &&
      (typeof label === 'string' ? l.label === label : label.test(l.label)),
  )?.value;

describe('IMM 1294 answers', () => {
  it('follows the form section order', () => {
    const a = imm1294Answers(PROFILE);
    const order = [...new Set(a.lines.map((l) => l.section))];
    expect(order).toEqual([
      'Personal details',
      'Languages',
      'Passport',
      'National identity document',
      'US permanent resident card',
      'Contact information',
      'Details of intended study in Canada',
      'Education',
      'Employment (past 10 years)',
      'Background information',
      'Signature',
    ]);
  });

  it('prints an other name recorded in one piece, not just its kind', () => {
    const a = imm1294Answers({
      ...PROFILE,
      has_other_names: 'yes',
      other_names: [{ name: 'Tariq Rahim', kind: 'alias' }],
    });
    expect(val(a, 'Personal details', '4. Have you ever used any other name?')).toBe(
      'Yes - Tariq Rahim, alias',
    );
  });

  it('fills personal details, passport and contact from the profile', () => {
    const a = imm1294Answers(PROFILE);
    const PD = 'Personal details';
    expect(val(a, PD, '1. UCI (if known)')).toBe('None - leave blank');
    expect(val(a, PD, '2. I want service in')).toBe('English');
    expect(val(a, PD, '3. Full name: family name(s)')).toBe('Rahimov');
    expect(val(a, PD, '3. Full name: given name(s)')).toBe('Tariq Ali');
    expect(val(a, PD, '4. Have you ever used any other name?')).toBe('No');
    expect(val(a, PD, '6. Date of birth (YYYY-MM-DD)')).toBe('2001-04-09');
    expect(val(a, PD, '7. Place of birth: city/town')).toBe('Lahore');
    expect(val(a, PD, '9. Status in that country')).toBe('Citizen');
    expect(val(a, PD, '9. From (YYYY-MM-DD)')).toBe('2001-04-09');
    expect(val(a, PD, /^10\..* - 1$/)).toBe(
      'United Arab Emirates, status: Worker, 2021-02 to 2022-01',
    );
    expect(val(a, PD, '12a. Current marital status')).toBe('Married');
    expect(val(a, PD, /^12b\./)).toBe('2024-12-01');
    expect(val(a, PD, /^12c\./)).toBe('Rahimova, Sana');
    expect(val(a, 'Languages', /^d\./)).toBe('Yes - IELTS Academic');
    expect(val(a, 'Passport', 'Passport number')).toBe('ZZ0000001');
    expect(val(a, 'Passport', 'Expiry date (YYYY-MM-DD)')).toBe('2032-02-28');
    expect(val(a, 'National identity document', 'Document number')).toBe(
      '00000-0000000-0',
    );
    expect(val(a, 'US permanent resident card', /green card/)).toBe('No');
    expect(val(a, 'Contact information', '1. Current mailing address')).toBe(
      PROFILE.residential_address,
    );
    expect(val(a, 'Contact information', '5. Email address')).toBe(
      'student@example.com',
    );
  });

  it('fills the intended study, costs and PAL from the study facts', () => {
    const a = imm1294Answers(PROFILE);
    const S = 'Details of intended study in Canada';
    expect(val(a, S, '1. Name of school')).toBe(
      'Example College of Applied Arts',
    );
    expect(val(a, S, '2. Level of study')).toBe('Post-graduate certificate');
    expect(val(a, S, '3. Field of study')).toBe('Business');
    expect(val(a, S, '4. Province or territory')).toBe('Ontario');
    expect(val(a, S, '4. City/town')).toBe('Toronto');
    expect(val(a, S, /DLI #/)).toBe('O000000000000');
    expect(val(a, S, '6. Student ID (if applicable)')).toBe(
      'None - leave blank',
    );
    expect(val(a, S, /from \(YYYY-MM-DD\)/)).toBe('2027-01-08');
    expect(val(a, S, /to \(YYYY-MM-DD\)/)).toBe('2027-12-15');
    expect(val(a, S, '8. Cost of studies: tuition')).toBe('CAD 18500');
    expect(val(a, S, '8. Cost of studies: room and board')).toBe('CAD 14000');
    expect(val(a, S, /^9\./)).toBe('CAD 42000');
    expect(val(a, S, /^10\./)).toBe('Myself and my father');
    expect(val(a, S, /PAL\/TAL\) number/)).toBe('ON-PAL-0000001');
  });

  it('writes education and employment rows', () => {
    const a = imm1294Answers(PROFILE);
    expect(val(a, 'Education', /post-secondary/)).toBe('Yes');
    expect(val(a, 'Education', 'School 1')).toBe(
      "2019-09 to 2023-06, Commerce, Bachelor's, Example University, Lahore, Pakistan",
    );
    const W = 'Employment (past 10 years)';
    const rows = a.lines.filter((l) => l.section === W).map((l) => l.value);
    expect(rows).toEqual([
      '2021-02 to 2022-01, Sales assistant, Example Trading LLC, Dubai, United Arab Emirates',
      '2023-07 to present, Accounts officer, Example Textiles, Lahore, Pakistan',
    ]);
  });

  it('answers background questions only from explicit answers, with details', () => {
    const a = imm1294Answers(PROFILE);
    const B = 'Background information';
    expect(val(a, B, /^1a\./)).toBe('No');
    expect(val(a, B, /^2b\./)).toBe(
      'Yes - United Kingdom, visitor visa, 2020-05, funds',
    );
    expect(val(a, B, /^2c\./)).toBe('No');
    expect(val(a, B, /^6\./)).toBe('No');
    expect(a.missing.filter((m) => m.startsWith(B))).toEqual([]);
  });

  it('never writes "No" for an unanswered declaration: it is listed as missing', () => {
    const {
      tuberculosis_contact: _tb,
      military_service: _ms,
      committed_crime: _cc,
      ...rest
    } = PROFILE;
    const a = imm1294Answers(rest);
    const B = 'Background information';
    expect(val(a, B, /^1a\./)).toBeUndefined();
    expect(val(a, B, /^3\./)).toBeUndefined();
    expect(val(a, B, /^4\./)).toBeUndefined();
    expect(a.missing).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Background information: 1a\./),
        expect.stringMatching(/^Background information: 3\./),
        expect.stringMatching(/^Background information: 4\./),
      ]),
    );
  });

  it('a "yes" without details asks for the details', () => {
    const a = imm1294Answers({ ...PROFILE, military_service: 'yes' });
    expect(val(a, 'Background information', /^4\./)).toBe('Yes');
    expect(a.missing).toContain('Background information: 4. details');
  });

  it('leaves what an empty profile lacks blank and lists it', () => {
    const a = imm1294Answers({});
    expect(a.missing).toEqual(
      expect.arrayContaining([
        'Personal details: 3. Full name: family name(s)',
        'Personal details: 6. Date of birth (YYYY-MM-DD)',
        'Passport: Passport number',
        'Details of intended study in Canada: 1. Name of school',
        'Details of intended study in Canada: 5. Designated learning institution number (DLI #)',
        expect.stringMatching(/^Education: Have you had any post-secondary/),
        expect.stringMatching(/^Employment/),
      ]),
    );
    expect(a.lines.some((l) => l.value === 'No')).toBe(false);
  });

  it('never fills the signature', () => {
    const a = imm1294Answers(PROFILE);
    const sig = a.lines.filter((l) => l.section === 'Signature');
    expect(sig).toHaveLength(1);
    expect(sig[0].value).toMatch(/Leave blank/);
  });
});

describe('IMM 1294 review fixes', () => {
  const B = 'Background information';

  it('Q3 is "No" only when all four criminal answers are explicit no', () => {
    const onlyCommitted = imm1294Answers({
      ...PROFILE,
      ever_arrested: undefined,
      ever_charged: undefined,
      ever_convicted: undefined,
    });
    expect(val(onlyCommitted, B, /^3\./)).toBeUndefined();
    expect(onlyCommitted.missing).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Background information: 3\./),
      ]),
    );
    expect(val(imm1294Answers(PROFILE), B, /^3\./)).toBe('No');
    const arrested = imm1294Answers({
      ...PROFILE,
      ever_arrested: 'yes',
      ever_arrested_details: '2019, Lahore, released without charge',
    });
    expect(val(arrested, B, /^3\./)).toBe(
      'Yes - 2019, Lahore, released without charge',
    );
  });

  it('Q1a is "No" only when TB contact and TB are both explicit no', () => {
    const contactOnly = imm1294Answers({ ...PROFILE, tuberculosis: undefined });
    expect(val(contactOnly, B, /^1a\./)).toBeUndefined();
    expect(contactOnly.missing).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Background information: 1a\./),
      ]),
    );
    expect(val(imm1294Answers(PROFILE), B, /^1a\./)).toBe('No');
    expect(
      val(imm1294Answers({ ...PROFILE, tuberculosis: 'yes' }), B, /^1a\./),
    ).toBe('Yes');
  });

  it('Q13: separated is not a previous marriage; divorced is', () => {
    const Q13 = /^13\./;
    const sep = imm1294Answers({ ...PROFILE, marital_status: 'Separated' });
    expect(val(sep, 'Personal details', Q13)).toBeUndefined();
    expect(sep.missing).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Personal details: 13\./),
      ]),
    );
    const div = imm1294Answers({ ...PROFILE, marital_status: 'Divorced' });
    expect(val(div, 'Personal details', Q13)).toBe('Yes');
    const said = imm1294Answers({
      ...PROFILE,
      marital_status: 'Separated',
      previously_married: 'no',
    });
    expect(val(said, 'Personal details', Q13)).toBe('No');
  });

  it('a language test answered "none" is No, never "Yes - None"', () => {
    for (const v of ['none', 'No', 'no test taken']) {
      const a = imm1294Answers({ ...PROFILE, language_test_type: v });
      expect(val(a, 'Languages', /^d\./)).toBe('No');
    }
  });

  it('the Canadian school is never written as the current employer', () => {
    const a = imm1294Answers({
      ...PROFILE,
      work_history: [],
      job_title: 'Student',
      school_name: 'Example College of Applied Arts',
      employer_name: 'Example College of Applied Arts',
      employment_start_date: '2023-07',
    });
    const rows = a.lines
      .filter((l) => l.section === 'Employment (past 10 years)')
      .map((l) => l.value);
    expect(rows).toEqual(['2023-07 to present, Student']);
  });

  it('issuing countries are never borrowed from citizenship', () => {
    const a = imm1294Answers({ ...PROFILE, passport_country: undefined });
    expect(val(a, 'Passport', 'Country or territory of issue')).toBeUndefined();
    expect(a.missing).toContain('Passport: Country or territory of issue');
    expect(a.missing).toContain(
      'National identity document: Country or territory of issue',
    );
  });

  it('"Citizen" is inferred only for a sole citizen', () => {
    const dual = imm1294Answers({ ...PROFILE, multiple_citizenship: 'yes' });
    expect(
      val(dual, 'Personal details', '9. Status in that country'),
    ).toBeUndefined();
    const others = imm1294Answers({
      ...PROFILE,
      other_citizenships: ['Canada'],
    });
    expect(
      val(others, 'Personal details', '9. Status in that country'),
    ).toBeUndefined();
    expect(
      val(
        imm1294Answers(PROFILE),
        'Personal details',
        '9. Status in that country',
      ),
    ).toBe('Citizen');
  });

  it('a value the font cannot print goes to missing, never corrupted', () => {
    const a = imm1294Answers({ ...PROFILE, city_of_birth: 'لاہور' });
    expect(
      val(a, 'Personal details', '7. Place of birth: city/town'),
    ).toBeUndefined();
    expect(a.missing).toContain(
      'Personal details: 7. Place of birth: city/town (write in your own script/letters as on passport)',
    );
    expect(a.lines.some((l) => l.value.includes('?'))).toBe(false);
  });

  it('renders a very long token (email) without throwing', async () => {
    const bytes = await renderImm1294(
      { fields: [] },
      {
        profile: {
          ...PROFILE,
          email: `${'a'.repeat(160)}@example.com`,
        },
      },
    );
    expect(Buffer.from(bytes!.slice(0, 4)).toString('latin1')).toBe('%PDF');
  });
});

describe('IMM 1294 sheet', () => {
  it('renders a PDF through the official-forms registry, with the profile', async () => {
    expect(isOfficialFormSupported('IMM 1294')).toBe(true);
    expect(isOfficialFormSupported('IMM1294')).toBe(true);
    const bytes = await tryRenderOfficialForm(
      'IMM 1294',
      { fields: [] } as never,
      { profile: PROFILE },
    );
    expect(bytes).not.toBeNull();
    expect(Buffer.from(bytes!.slice(0, 4)).toString('latin1')).toBe('%PDF');
    const doc = await PDFDocument.load(bytes!);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('renders even an empty profile (everything listed to fill by hand)', async () => {
    const bytes = await renderImm1294({ fields: [] }, { profile: {} });
    expect(Buffer.from(bytes!.slice(0, 4)).toString('latin1')).toBe('%PDF');
  });

  it('carries the IRCC-account note, and leaves IMM 5257 alone', () => {
    expect(preparedFormNote('IMM 1294')).toMatch(/IRCC secure account/);
    expect(preparedFormNote('IMM 1294')).toMatch(/Validate/);
    expect(preparedFormNote('imm1294')).toBeDefined();
    expect(preparedFormNote('IMM 5257')).toBeUndefined();
    expect(isOfficialFormSupported('IMM 5257')).toBe(true);
  });
});
