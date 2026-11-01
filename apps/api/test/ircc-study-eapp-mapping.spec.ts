/**
 * The study permit's eligibility questionnaire in the IRCC secure account
 * (onlineservices-servicesenligne.cic.gc.ca/eapp/eapp), recorded live
 * 2026-10-20. One URL for every screen, one id (`answerlist[0]`) for a
 * different question on each, so every write is scoped to its question.
 *
 * The applicant below is FICTIONAL. It has the shape of the recorded run
 * (Pakistani, living in Pakistan, PAL from Ontario, married, spouse staying
 * home) and must produce exactly the answers recorded live.
 */
import '../src/modules/automation/portal-fills/canada-ircc';
import '../src/modules/automation/portal-fills/canada-ircc-eta';
import '../src/modules/automation/portal-fills/canada-ircc-study-eapp';
import { CA_STUDY_VISAAI_ID } from '@visaai/types';
import {
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import {
  isProgressivePage,
  resolvePortalFill,
  resolvePortalFillFor,
  scopedSelector,
} from '../src/strategies/portal-integration/portal-fill.registry';
import { portalForRoute } from '../src/strategies';
import {
  EAPP_PAGE,
  attestationAnswer,
  postSecondary,
  provinceCode,
} from '../src/modules/automation/portal-fills/canada-ircc-study-eapp';

const mapping = () => resolvePortalFill('ircc-study')!;

/** Fictional applicant; no real person's data. */
const STUDENT: Record<string, unknown> = {
  family_name: 'Example',
  given_name: 'Test Student',
  date_of_birth: '1991-03-14',
  nationality: 'Pakistan',
  country_of_residence: 'Pakistan (citizen)',
  family_member_canadian_status: 'No',
  has_attestation_letter: 'Yes',
  study_province: 'Ontario',
  study_school_name: 'Example College of Applied Arts',
  dli_number: 'O000000000000',
  study_level: 'Post-graduate certificate',
  study_start_date: '2027-01-11',
  study_end_date: '2027-12-17',
  us_permanent_resident: 'No',
  marital_status: 'Married',
  spouse_coming_to_canada: 'No',
  has_children: 'Yes',
  children_accompanying: [],
  previous_canada_application: 'No',
  exchange_student: 'No',
  work_essential_to_studies: 'No',
  government_scholarship: 'No',
  family_member_status_in_canada: 'No',
  committed_crime: 'No',
  ever_arrested: 'No',
  ever_charged: 'No',
  ever_convicted: 'No',
  medical_exam_last_12_months: 'No',
  designated_country_six_months: 'Yes',
  uses_representative: 'No',
  biometrics_given: 'Yes',
};

const inputs = (p: Record<string, unknown>) => buildMappingInputs(mapping(), p);
const byKey = (p: Record<string, unknown>) => {
  const out: Record<string, string> = {};
  for (const i of inputs(p))
    out[
      i.label?.endsWith('— month')
        ? 'dob_month'
        : i.label?.endsWith('— year')
          ? 'dob_year'
          : i.label?.endsWith('— day')
            ? 'dob_day'
            : i.fieldKey
    ] = String(i.mappedValue);
  return out;
};

describe('study permit: the secure-account questionnaire (eapp)', () => {
  it('the route fills the questionnaire, on its own portal', () => {
    const portal = portalForRoute('CA', CA_STUDY_VISAAI_ID);
    expect(portal).toMatchObject({
      portalId: 'ircc-study',
      assistedFill: true,
    });
    expect(portal?.portalUrl).toMatch(/canada\.ca\/.*account\.html$/);
    expect(resolvePortalFillFor('ircc-study', CA_STUDY_VISAAI_ID)).toBe(
      mapping(),
    );
    expect(isProgressivePage(EAPP_PAGE)).toBe(true);
  });

  it('answers exactly what was recorded live', () => {
    expect(byKey(STUDENT)).toEqual({
      eapp_purpose: '7120',
      eapp_stay_length: '7347',
      eapp_family_member_citizen_or_pr: '997',
      dob_month: '1822',
      eapp_passport_code: 'PAK (Pakistan)',
      eapp_country_of_residence: 'Pakistan',
      dob_year: '1991',
      dob_day: '14',
      eapp_attestation_letter: '376806',
      eapp_attestation_province: '2731',
      eapp_us_permanent_resident: '997',
      eapp_accepted_to_dli: '991',
      eapp_post_secondary: '991',
      eapp_marital_status: '2952',
      eapp_destination_province: '2731',
      eapp_valid_permit: '7225',
      eapp_exchange_student: '997',
      eapp_work_essential: '997',
      eapp_family_of_worker_or_student: '997',
      eapp_government_scholarship: '997',
      eapp_accompanying_family_member: '997',
      eapp_criminality: '997',
      eapp_medical_exam_12_months: '997',
      eapp_designated_country: '991',
      eapp_family_member_application: '997',
      eapp_representative_access: 'No',
      eapp_biometrics: '991',
    });
  });

  it('every write is on /eapp/eapp and scoped to its question', () => {
    const all = inputs(STUDENT);
    for (const i of all) {
      expect(i.page).toBe(EAPP_PAGE);
      expect(i.targetField).toMatch(/ >> (label|page)=\/.+\/i/);
    }
    const sel = (k: string) => all.find((i) => i.fieldKey === k)!.targetField;
    expect(sel('eapp_purpose')).toBe(
      'select[id="answerlist[1]"] >> label=/what would you like to do in canada/i >> option=value:7120',
    );
    expect(sel('eapp_exchange_student')).toBe(
      'select[id^="answerlist["] >> label=/are you an exchange student/i >> option=value:997',
    );
    // Option text for the lists chosen by text.
    expect(sel('eapp_passport_code')).toMatch(
      / >> option=text:PAK \(Pakistan\)$/,
    );
    expect(sel('eapp_representative_access')).toBe(
      'input[type="radio"][name="answerList[0].value"][value="7343"] >> page=/are you giving someone access to your application/i',
    );
    const month = all.find((i) => i.label === 'Date of birth — month')!;
    expect(month.targetField).toBe(
      'select[id="answerlist[8]"] >> page=/what is your date of birth/i >> option=value:1822',
    );
    expect(
      all.find((i) => i.label === 'Date of birth — day')!.targetField,
    ).toMatch(/ >> option=text:14$/);
    expect(month.op).toBeUndefined();
    expect(all.find((i) => i.label === 'Date of birth — year')!.op).toBe(
      'select_text',
    );
    expect(
      all.find((i) => i.fieldKey === 'eapp_representative_access')!.op,
    ).toBe('radio');
    // No two writes name the same control.
    expect(new Set(all.map((i) => i.targetField)).size).toBe(all.length);
  });

  it('the declarations are marked and answered only from explicit answers', () => {
    const decl = inputs(STUDENT)
      .filter((i) => i.declaration)
      .map((i) => i.fieldKey);
    expect(decl.sort()).toEqual(
      [
        'eapp_criminality',
        'eapp_designated_country',
        'eapp_medical_exam_12_months',
      ].sort(),
    );
    const silent = { ...STUDENT };
    delete silent.committed_crime;
    delete silent.medical_exam_last_12_months;
    delete silent.designated_country_six_months;
    const keys = inputs(silent).map((i) => i.fieldKey);
    expect(keys).not.toContain('eapp_criminality');
    expect(keys).not.toContain('eapp_medical_exam_12_months');
    expect(keys).not.toContain('eapp_designated_country');
    // ...and listed for the applicant.
    const left = portalFillCoverage(mapping(), silent).pages[0].left;
    for (const label of [
      'Committed, arrested, charged or convicted of a criminal offence',
      'Medical exam by an IRCC panel physician in the last 12 months',
      'Lived in or visited a designated country for 6 months in the last year',
    ])
      expect(left).toContainEqual(
        expect.objectContaining({ label, reason: 'needs_your_answer' }),
      );
  });

  it('criminality: "No" only when all four parts are an explicit no', () => {
    const crime = (over: Record<string, unknown>) =>
      byKey({ ...STUDENT, ...over }).eapp_criminality;
    expect(crime({})).toBe('997');
    expect(crime({ ever_convicted: 'Yes' })).toBe('991');
    expect(crime({ been_charged: 'yes', ever_charged: undefined })).toBe('991');
    expect(crime({ criminal_record: true, ever_convicted: undefined })).toBe(
      '991',
    );
    expect(crime({ criminal_charges_or_convictions: 'Yes' })).toBe('991');
    // committed_crime "No" alone answers nothing.
    const onlyCommitted = { ...STUDENT };
    delete onlyCommitted.ever_arrested;
    delete onlyCommitted.ever_charged;
    delete onlyCommitted.ever_convicted;
    expect(byKey(onlyCommitted).eapp_criminality).toBeUndefined();
    expect(crime({ ever_charged: undefined })).toBeUndefined();
    expect(crime({ ever_arrested: "I don't know" })).toBeUndefined();
  });

  it('criminality: a "no" to "any charges or convictions" covers arrested, charged and convicted — not committed', () => {
    const base = { ...STUDENT };
    delete base.ever_arrested;
    delete base.ever_charged;
    delete base.ever_convicted;
    const crime = (over: Record<string, unknown>) =>
      byKey({ ...base, ...over }).eapp_criminality;
    expect(crime({ criminal_charges_or_convictions: 'No' })).toBe('997');
    // Committed still needs committed_crime.
    expect(
      crime({
        criminal_charges_or_convictions: 'No',
        committed_crime: undefined,
      }),
    ).toBeUndefined();
    // A part's own "yes" wins over the combined "no".
    expect(
      crime({ criminal_charges_or_convictions: 'No', ever_arrested: 'Yes' }),
    ).toBe('991');
    expect(crime({ criminal_charges_or_convictions: 'Yes' })).toBe('991');
  });

  it('a missing answer leaves the control empty, never a guess', () => {
    const bare = byKey({ date_of_birth: '1991-03-14' });
    expect(bare).toEqual({
      eapp_purpose: '7120',
      dob_month: '1822',
      dob_year: '1991',
      dob_day: '14',
    });
  });

  it('never answers the fee, digital-copy or payment questions', () => {
    const labels = mapping().map((f) => f.label.toLowerCase());
    for (const l of labels) expect(l).not.toMatch(/fee|pay|digital cop/);
    const left = portalFillCoverage(mapping(), STUDENT).pages[0].left.map(
      (n) => n.label,
    );
    expect(left).toEqual(
      expect.arrayContaining([
        'Application fees: paying or fee-exempt',
        'Making digital copies of your documents',
        'Paying your fees online',
        'Review your answers, then your document checklist',
      ]),
    );
  });

  it('PAL: a letter, a stated exception, or nothing', () => {
    expect(
      attestationAnswer({ has_attestation_letter: 'Yes, Ontario PAL' }),
    ).toBe('376806');
    expect(attestationAnswer({ has_attestation_letter: true })).toBe('376806');
    expect(
      attestationAnswer({
        has_attestation_letter: "No - master's at a public university",
      }),
    ).toBe('376807');
    expect(attestationAnswer({ has_attestation_letter: 'No' })).toBeUndefined();
    expect(attestationAnswer({})).toBeUndefined();
    // An exception skips the province screen (live 2026-10-20).
    const ex = byKey({
      ...STUDENT,
      has_attestation_letter: 'No, exchange student',
    });
    expect(ex.eapp_attestation_letter).toBe('376807');
    expect(ex.eapp_attestation_province).toBeUndefined();
  });

  it('Quebec: destination answered, the CAQ path (not seen live) left', () => {
    const qc = byKey({ ...STUDENT, study_province: 'Québec' });
    expect(qc.eapp_destination_province).toBe('2732');
    expect(qc.eapp_attestation_province).toBeUndefined();
    const left = portalFillCoverage(mapping(), {
      ...STUDENT,
      study_province: 'QC',
    }).pages[0].left;
    expect(left).toContainEqual(
      expect.objectContaining({ label: 'Quebec: attestation letter province' }),
    );
    expect(provinceCode('B.C.')).toBe('2721');
    expect(provinceCode('Nowhere')).toBeUndefined();
  });

  it('post-secondary from the program level', () => {
    expect(postSecondary({ study_level: "Master's" })).toBe('991');
    expect(postSecondary({ study_level: 'College diploma' })).toBe('991');
    expect(postSecondary({ study_level: 'post-secondary' })).toBe('991');
    expect(postSecondary({ study_level: 'Secondary school' })).toBe('997');
    expect(
      postSecondary({ study_level: 'Language training (ESL)' }),
    ).toBeUndefined();
    expect(postSecondary({})).toBeUndefined();
  });

  it('stay length only when the program runs over six months', () => {
    expect(
      byKey({ ...STUDENT, study_end_date: '2027-05-01' }).eapp_stay_length,
    ).toBeUndefined();
    expect(
      byKey({ ...STUDENT, study_end_date: undefined }).eapp_stay_length,
    ).toBeUndefined();
  });

  it('family and representative questions answer "No" only from a no', () => {
    const rep = byKey({ ...STUDENT, uses_representative: 'Yes' });
    expect(rep.eapp_representative_access).toBeUndefined();
    expect(
      byKey({ ...STUDENT, authorize_release_of_information: 'Yes' })
        .eapp_representative_access,
    ).toBeUndefined();
    const fam = byKey({ ...STUDENT, family_member_status_in_canada: 'Yes' });
    expect(fam.eapp_family_of_worker_or_student).toBeUndefined();
    expect(fam.eapp_accompanying_family_member).toBeUndefined();
    expect(
      byKey({ ...STUDENT, spouse_coming_to_canada: 'Yes' })
        .eapp_family_member_application,
    ).toBeUndefined();
    expect(
      byKey({ ...STUDENT, children_accompanying: ['Child One'] })
        .eapp_family_member_application,
    ).toBeUndefined();
    // A visa number under "applied before" is a yes: the permit question is theirs.
    expect(
      byKey({ ...STUDENT, previous_canada_application: 'Yes' })
        .eapp_valid_permit,
    ).toBeUndefined();
  });

  it('a UK resident or an unlisted passport code is left for the applicant', () => {
    const uk = byKey({
      ...STUDENT,
      country_of_residence: 'United Kingdom',
      nationality: 'GBN',
    });
    expect(uk.eapp_country_of_residence).toBeUndefined();
    expect(uk.eapp_passport_code).toBeUndefined();
  });

  it('scopedSelector: the option part comes last and is checked', () => {
    expect(
      scopedSelector('#a', /x/, undefined, { by: 'value', value: '991' }),
    ).toBe('#a >> label=/x/i >> option=value:991');
    expect(() =>
      scopedSelector('#a', /x/, undefined, { by: 'text', value: 'a >> b' }),
    ).toThrow();
  });

  it('scopedSelector: plain CSS without a scope; flags normalised', () => {
    expect(scopedSelector('#a')).toBe('#a');
    expect(scopedSelector('#a', /x/g, /y/)).toBe(
      '#a >> label=/x/i >> page=/y/i',
    );
    expect(() => scopedSelector('#a', /a >> b/)).toThrow();
  });
});
