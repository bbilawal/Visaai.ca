/**
 * The work permit's branch of the IRCC secure-account eligibility
 * questionnaire (/eapp/eapp), recorded live 2026-10-30. Same URL and the
 * same reused ids as the study permit's branch; "Work" is 7123.
 *
 * The applicants below are FICTIONAL (no real person's data).
 */
import '../src/modules/automation/portal-fills/canada-ircc';
import '../src/modules/automation/portal-fills/canada-ircc-eta';
import '../src/modules/automation/portal-fills/canada-ircc-super-visa';
import '../src/modules/automation/portal-fills/canada-ircc-business-visitor';
import '../src/modules/automation/portal-fills/canada-ircc-pr-family';
import '../src/modules/automation/portal-fills/canada-ircc-study-eapp';
import '../src/modules/automation/portal-fills/canada-ircc-work-eapp';
import {
  CA_ETA_VISAAI_ID,
  CA_SPOUSAL_VISAAI_ID,
  CA_STUDY_VISAAI_ID,
  CA_WORK_VISAAI_ID,
} from '@visaai/types';
import {
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import {
  isProgressivePage,
  portalPageTitle,
  registerPortalFill,
  resolvePortalFill,
  resolvePortalFillFor,
} from '../src/strategies/portal-integration/portal-fill.registry';
import { portalForRoute } from '../src/strategies';
import {
  EAPP_PAGE,
  EAPP_PAGES,
} from '../src/modules/automation/portal-fills/canada-ircc-eapp-common';
import {
  jobOffer,
  offerStatus,
  spouseOfStudent,
  spouseOfWorker,
  workStayLength,
} from '../src/modules/automation/portal-fills/canada-ircc-work-eapp';

const mapping = () => resolvePortalFill('ircc-work')!;
const TRV = 'ca-visitor-visa-temporary-resident-visa';
const SUPER = 'ca-super-visa';
const BUSINESS = 'ca-business-visitors';

/** The shared answers: identity, family, declarations (as the study test). */
const BASE: Record<string, unknown> = {
  family_name: 'Example',
  given_name: 'Test Worker',
  date_of_birth: '1991-03-14',
  nationality: 'Pakistan',
  country_of_residence: 'Pakistan (citizen)',
  family_member_canadian_status: 'No',
  us_permanent_resident: 'No',
  marital_status: 'Married',
  spouse_coming_to_canada: 'No',
  has_children: 'Yes',
  children_accompanying: [],
  previous_canada_application: 'No',
  family_member_status_in_canada: 'No',
  public_policy_or_special_measure: 'No',
  committed_crime: 'No',
  ever_arrested: 'No',
  ever_charged: 'No',
  ever_convicted: 'No',
  medical_exam_last_12_months: 'No',
  designated_country_six_months: 'No',
  uses_representative: 'No',
  biometrics_given: 'Yes',
};

/** An LMIA job in Ontario for two years. */
const LMIA: Record<string, unknown> = {
  ...BASE,
  work_permit_type: 'lmia',
  lmia_number: '1234567',
  work_employer_name: 'Maple Test Foods Inc.',
  work_location_province: 'Ontario',
  work_start_date: '2027-01-11',
  work_end_date: '2029-01-10',
};

/** An open work permit as the spouse of a worker in Canada. */
const OPEN_SPOUSE_OF_WORKER: Record<string, unknown> = {
  ...BASE,
  work_permit_type: 'open',
  principal_relationship: 'spouse of a worker',
  work_start_date: '2027-01-11',
  work_end_date: '2028-06-30',
};

/** Study answers a profile may still hold after switching routes. */
const STUDY_LEFTOVERS: Record<string, unknown> = {
  has_attestation_letter: 'Yes',
  study_province: 'Ontario',
  dli_number: 'O000000000000',
  study_school_name: 'Example College',
  study_level: "Master's",
  study_start_date: '2027-01-11',
  study_end_date: '2027-12-17',
  exchange_student: 'No',
  work_essential_to_studies: 'No',
  government_scholarship: 'No',
  accepted_to_dli: 'Yes',
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

const STUDY_ONLY_KEYS = [
  'eapp_attestation_letter',
  'eapp_attestation_province',
  'eapp_accepted_to_dli',
  'eapp_post_secondary',
  'eapp_exchange_student',
  'eapp_work_essential',
  'eapp_government_scholarship',
];

describe('work permit: the secure-account questionnaire (eapp), Work branch', () => {
  it('the route fills its own portal id on the shared questionnaire page', () => {
    expect(portalForRoute('CA', CA_WORK_VISAAI_ID)).toMatchObject({
      portalId: 'ircc-work',
      assistedFill: true,
    });
    expect(resolvePortalFillFor('ircc-work', CA_WORK_VISAAI_ID)).toBe(
      mapping(),
    );
    // Never the study mapping, and the study route keeps its own.
    expect(mapping()).not.toBe(resolvePortalFill('ircc-study'));
    expect(resolvePortalFillFor('ircc-study', CA_STUDY_VISAAI_ID)).toBe(
      resolvePortalFill('ircc-study'),
    );
    expect(isProgressivePage(EAPP_PAGE)).toBe(true);
    expect(portalPageTitle(EAPP_PAGE)).toBe(EAPP_PAGES[0].title);
  });

  it('an LMIA job: Work, over six months, job offer Yes, a year or more', () => {
    expect(byKey({ ...LMIA, job_offer_status: 'temporary' })).toEqual({
      eapp_purpose: '7123',
      eapp_stay_length: '7347',
      eapp_family_member_citizen_or_pr: '997',
      dob_month: '1822',
      eapp_passport_code: 'PAK (Pakistan)',
      eapp_country_of_residence: 'Pakistan',
      dob_year: '1991',
      dob_day: '14',
      eapp_us_permanent_resident: '997',
      eapp_job_offer: '991',
      eapp_job_offer_status: '7319',
      eapp_public_policy: '997',
      eapp_marital_status: '2952',
      eapp_destination_province: '2731',
      eapp_valid_permit: '7225',
      eapp_work_permit_type: '7664',
      eapp_accompanying_family_member: '997',
      eapp_criminality: '997',
      eapp_medical_exam_12_months: '997',
      eapp_designated_country: '997',
      eapp_family_member_application: '997',
      eapp_representative_access: 'No',
      eapp_biometrics: '991',
    });
  });

  it("an open permit as a worker's spouse: job offer No, spouse-of-worker Yes, spouse-of-student No", () => {
    const v = byKey(OPEN_SPOUSE_OF_WORKER);
    expect(v.eapp_purpose).toBe('7123');
    expect(v.eapp_job_offer).toBe('997');
    expect(v.eapp_job_offer_status).toBeUndefined();
    expect(v.eapp_spouse_of_worker).toBe('991');
    expect(v.eapp_spouse_of_student).toBe('997');
    // No work location for an open permit: destination left.
    expect(v.eapp_destination_province).toBeUndefined();
    // Held through a family member in Canada: the tail's family-status
    // questions are never "No", even if the applicant said so.
    expect(v.eapp_accompanying_family_member).toBeUndefined();
    // A worker's family member: the open permit type.
    expect(v.eapp_work_permit_type).toBe('7673');
    const left = portalFillCoverage(mapping(), OPEN_SPOUSE_OF_WORKER).pages[0]
      .left;
    expect(left).toContainEqual(
      expect.objectContaining({
        label: 'Your family member’s status in Canada',
      }),
    );
    // A student's spouse: the other way round.
    const student = byKey({
      ...OPEN_SPOUSE_OF_WORKER,
      principal_relationship: 'spouse of a student',
    });
    expect(student.eapp_spouse_of_worker).toBe('997');
    expect(student.eapp_spouse_of_student).toBe('991');
  });

  it('never emits a study-only answer, even from study answers on the profile', () => {
    for (const p of [LMIA, OPEN_SPOUSE_OF_WORKER, {}]) {
      const all = inputs({ ...p, ...STUDY_LEFTOVERS });
      const keys = all.map((i) => i.fieldKey);
      for (const k of STUDY_ONLY_KEYS) expect(keys).not.toContain(k);
      for (const i of all) {
        expect(String(i.mappedValue)).not.toBe('7120');
        expect(i.targetField).not.toMatch(
          /option=value:(7120|376806|376807)\b/,
        );
        expect(i.targetField).not.toMatch(
          /attestation|designated learning|post-secondary|exchange student|essential component|commonwealth/,
        );
      }
    }
    // The mapping itself has no study entry and no 7120.
    for (const f of mapping()) {
      expect(STUDY_ONLY_KEYS).not.toContain(f.profileKey);
      expect(f.label).not.toMatch(/\(Study\)/);
    }
    // Study dates never decide the work stay length.
    expect(
      byKey({ ...STUDY_LEFTOVERS, date_of_birth: '1991-03-14' })
        .eapp_stay_length,
    ).toBeUndefined();
  });

  it('every write is on /eapp/eapp, scoped to its question, one control each', () => {
    const all = inputs({ ...LMIA, job_offer_status: 'temporary' });
    for (const i of all) {
      expect(i.page).toBe(EAPP_PAGE);
      expect(i.targetField).toMatch(/ >> (label|page)=\/.+\/i/);
    }
    const sel = (k: string) => all.find((i) => i.fieldKey === k)!.targetField;
    expect(sel('eapp_purpose')).toBe(
      'select[id="answerlist[1]"] >> label=/what would you like to do in canada/i >> option=value:7123',
    );
    expect(sel('eapp_job_offer')).toBe(
      'select[id^="answerlist["] >> label=/i have a job offer and my employer gave me an offer of employment number or lmia number/i >> option=value:991',
    );
    expect(sel('eapp_job_offer_status')).toMatch(/ >> option=value:7319$/);
    // The valid-permit question's own "No" is 7225, not 997.
    expect(sel('eapp_valid_permit')).toMatch(/ >> option=value:7225$/);
    expect(new Set(all.map((i) => i.targetField)).size).toBe(all.length);
  });

  it('job offer: Yes only with the matching number, No only for an open permit', () => {
    expect(jobOffer({ work_permit_type: 'lmia', lmia_number: '1234567' })).toBe(
      '991',
    );
    expect(jobOffer({ work_permit_type: 'lmia', lmia_number: 1234567 })).toBe(
      '991',
    );
    expect(jobOffer({ work_permit_type: 'lmia' })).toBeUndefined();
    expect(
      jobOffer({ work_permit_type: 'lmia', lmia_number: 'not required' }),
    ).toBeUndefined();
    // An offer number is not an LMIA number, and the other way round.
    expect(
      jobOffer({
        work_permit_type: 'lmia',
        offer_of_employment_number: 'A1234567',
      }),
    ).toBeUndefined();
    expect(
      jobOffer({
        work_permit_type: 'lmia_exempt',
        offer_of_employment_number: 'A1234567',
      }),
    ).toBe('991');
    expect(
      jobOffer({ work_permit_type: 'LMIA-exempt', lmia_number: '1234567' }),
    ).toBeUndefined();
    expect(jobOffer({ work_permit_type: 'open' })).toBe('997');
    expect(jobOffer({ work_permit_type: 'other' })).toBeUndefined();
    expect(jobOffer({})).toBeUndefined();
    // No number, no Yes: the status screen is not answered either.
    const noNumber = byKey({ ...LMIA, lmia_number: undefined });
    expect(noNumber.eapp_job_offer).toBeUndefined();
    expect(noNumber.eapp_job_offer_status).toBeUndefined();
  });

  it('offer status only from a stated term, never from the dates alone (review 2026-10-30)', () => {
    // Dates alone: left — a permanent job can carry an LMIA end date.
    expect(
      offerStatus({ work_start_date: '2027-01-11', work_end_date: '2028-01-11' }),
    ).toBeUndefined();
    expect(byKey(LMIA).eapp_job_offer_status).toBeUndefined();
    expect(
      offerStatus({
        job_offer_status: 'Temporary',
        work_start_date: '2027-01-11',
        work_end_date: '2028-01-11',
      }),
    ).toBe('7319');
    expect(
      offerStatus({
        job_offer_status: 'temporary',
        work_start_date: '2027-01-11',
        work_end_date: '2028-01-10',
      }),
    ).toBe('7318');
    expect(offerStatus({ job_offer_status: 'permanent position' })).toBe('7948');
    expect(offerStatus({ job_offer_status: 'temporary', work_start_date: '2027-01-11' })).toBeUndefined();
    expect(
      offerStatus({
        job_offer_status: 'temporary',
        work_start_date: '2027-01-11',
        work_end_date: '2026-01-01',
      }),
    ).toBeUndefined();
    // Month-end start: Aug 31 + 6 months is Feb 29 (2028), not Mar 2.
    expect(workStayLength({ work_start_date: '2027-08-31', work_end_date: '2028-03-01' })).toBe('7347');
    expect(workStayLength({ work_start_date: '2027-08-31', work_end_date: '2028-02-28' })).toBe('7346');
    // The CURRENT job's dates are not the work in Canada.
    expect(
      offerStatus({
        employment_start_date: '2019-04-01',
        employment_end_date: '2030-01-01',
      }),
    ).toBeUndefined();
    expect(
      workStayLength({
        work_start_date: '2027-01-11',
        work_end_date: '2027-04-30',
      }),
    ).toBe('7346');
    expect(
      workStayLength({
        work_start_date: '2027-01-11',
        work_end_date: '2027-07-12',
      }),
    ).toBe('7347');
    expect(
      workStayLength({
        work_start_date: '2027-01-11',
        work_end_date: '2027-07-11',
      }),
    ).toBeUndefined();
    const short = byKey({ ...LMIA, job_offer_status: 'temporary', work_end_date: '2027-05-01' });
    expect(short.eapp_job_offer_status).toBe('7318');
    expect(short.eapp_stay_length).toBe('7346');
  });

  it('spouse-of-worker / spouse-of-student only for an open permit with a known family member', () => {
    expect(
      spouseOfWorker({
        work_permit_type: 'open',
        principal_relationship: 'dependent child of a worker',
      }),
    ).toBe('991');
    expect(spouseOfWorker({ work_permit_type: 'open' })).toBeUndefined();
    expect(
      spouseOfWorker({
        work_permit_type: 'lmia',
        principal_relationship: 'spouse of a worker',
      }),
    ).toBeUndefined();
    expect(spouseOfStudent({ work_permit_type: 'lmia' })).toBeUndefined();
    expect(
      spouseOfStudent({
        work_permit_type: 'open',
        principal_relationship: 'worker and student',
      }),
    ).toBeUndefined();
    // A student's dependent child is not their spouse or partner.
    expect(
      spouseOfStudent({ work_permit_type: 'open', principal_relationship: 'dependent child of a study permit holder' }),
    ).toBe('997');
    expect(
      spouseOfStudent({ work_permit_type: 'open', principal_relationship: 'spouse of an international student' }),
    ).toBe('991');
    const lmia = byKey(LMIA);
    expect(lmia.eapp_spouse_of_worker).toBeUndefined();
    expect(lmia.eapp_spouse_of_student).toBeUndefined();
  });

  it('exempt category and recent graduate only from the applicant\'s own yes / no (2026-10-30)', () => {
    const b = byKey({ ...LMIA, work_permit_exempt_category: 'No', recent_canadian_graduate: 'no' });
    expect(b.eapp_work_permit_exempt).toBe('997');
    expect(b.eapp_recent_canadian_graduate).toBe('997');
    expect(byKey({ ...LMIA, work_permit_exempt_category: 'Yes, business visitor' }).eapp_work_permit_exempt).toBe('991');
    expect(byKey(LMIA).eapp_work_permit_exempt).toBeUndefined();
    expect(byKey({ ...LMIA, recent_canadian_graduate: 'not sure' }).eapp_recent_canadian_graduate).toBeUndefined();
  });

  it('type of work permit from the permit kind; the study-only screen is never targeted (fresh recording 2026-10-31)', () => {
    expect(byKey({ ...LMIA, work_permit_type: 'lmia_exempt' }).eapp_work_permit_type).toBe('7675');
    expect(byKey({ ...LMIA, work_permit_type: 'sawp' }).eapp_work_permit_type).toBe('7663');
    expect(byKey({ ...LMIA, work_permit_type: 'other' }).eapp_work_permit_type).toBeUndefined();
    for (const f of mapping()) expect(f.profileKey).not.toBe('eapp_family_of_worker_or_student');
    const left = portalFillCoverage(mapping(), LMIA).pages[0].left.map((n) => n.label);
    expect(left).not.toContain('Exchange student, co-op studies, government scholarship');
    expect(left).toContain('Global Talent Stream; professional association membership');
  });

  it('branch-sweep follow-ups (2026-10-31): travel document only when accompanying, notes only when they apply', () => {
    expect(byKey({ ...LMIA, passport_number: 'CK1807664' }).eapp_travel_document_type).toBeUndefined();
    expect(
      byKey({ ...LMIA, passport_number: 'CK1807664', family_member_status_in_canada: 'Yes, my spouse is a worker' })
        .eapp_travel_document_type,
    ).toBe('7344');
    const left = (p: Record<string, unknown>) => portalFillCoverage(mapping(), p).pages[0].left.map((n) => n.label);
    expect(left(LMIA)).not.toContain('Travelling to Canada directly from the U.S. or St. Pierre and Miquelon');
    expect(left({ ...LMIA, us_permanent_resident: 'Yes' })).toContain(
      'Travelling to Canada directly from the U.S. or St. Pierre and Miquelon',
    );
    expect(left({ ...LMIA, recent_canadian_graduate: 'Yes' })).toContain('School letter confirming completion and final transcript');
    expect(left({ work_permit_type: 'open', principal_relationship: 'spouse of a student' })).toContain(
      'Which option applies to your student spouse',
    );
    expect(left({ ...LMIA, uses_representative: 'Yes' })).toContain('Submission letter from your representative');
    // Valid-permit Yes (live 2026-10-31): IRCC skips the work screens.
    expect(left(LMIA)).not.toContain('Which Canadian permit you already hold');
    expect(left({ ...LMIA, has_valid_canadian_permit: 'Yes' })).toContain('Which Canadian permit you already hold');
    expect(byKey({ ...LMIA, has_valid_canadian_permit: 'Yes' }).eapp_valid_permit).toBeUndefined();
  });

  it('a missing answer leaves the control empty, never a guess', () => {
    expect(byKey({ date_of_birth: '1991-03-14' })).toEqual({
      eapp_purpose: '7123',
      dob_month: '1822',
      dob_year: '1991',
      dob_day: '14',
    });
    // The student questions on the shared screen, and the fee screens, are
    // listed for the applicant.
    const left = portalFillCoverage(mapping(), LMIA).pages[0].left.map(
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
    for (const l of mapping().map((f) => f.label.toLowerCase()))
      expect(l).not.toMatch(/fee|pay|digital cop/);
  });

  it('declarations: marked, and answered only from explicit answers', () => {
    const decl = inputs(LMIA)
      .filter((i) => i.declaration)
      .map((i) => i.fieldKey)
      .sort();
    expect(decl).toEqual(
      [
        'eapp_criminality',
        'eapp_designated_country',
        'eapp_medical_exam_12_months',
        'eapp_public_policy',
      ].sort(),
    );
    const silent = { ...LMIA };
    for (const k of [
      'public_policy_or_special_measure',
      'committed_crime',
      'medical_exam_last_12_months',
      'designated_country_six_months',
    ])
      delete silent[k];
    const keys = inputs(silent).map((i) => i.fieldKey);
    for (const k of decl) expect(keys).not.toContain(k);
    const left = portalFillCoverage(mapping(), silent).pages[0].left;
    expect(left).toContainEqual(
      expect.objectContaining({
        label: 'Coming under an IRCC public policy or special measure',
        reason: 'needs_your_answer',
      }),
    );
    expect(
      byKey({ ...LMIA, public_policy_or_special_measure: 'Yes, CUAET' })
        .eapp_public_policy,
    ).toBe('991');
  });

  it('criminality: "No" only when all four parts are an explicit no', () => {
    const crime = (over: Record<string, unknown>) =>
      byKey({ ...LMIA, ...over }).eapp_criminality;
    expect(crime({})).toBe('997');
    expect(crime({ ever_convicted: 'Yes' })).toBe('991');
    expect(crime({ ever_charged: undefined })).toBeUndefined();
    expect(crime({ ever_arrested: "I don't know" })).toBeUndefined();
    const onlyCommitted = { ...LMIA };
    delete onlyCommitted.ever_arrested;
    delete onlyCommitted.ever_charged;
    delete onlyCommitted.ever_convicted;
    expect(byKey(onlyCommitted).eapp_criminality).toBeUndefined();
  });

  it('the other routes keep their own mappings', () => {
    const tr = resolvePortalFill('ircc')!;
    expect(portalForRoute('CA', TRV)).toMatchObject({
      portalId: 'ircc',
      assistedFill: true,
    });
    expect(resolvePortalFillFor('ircc', TRV)).toBe(tr);
    expect(resolvePortalFillFor('ircc', SUPER)).not.toBe(mapping());
    expect(resolvePortalFillFor('ircc', BUSINESS)).not.toBe(mapping());
    expect(portalForRoute('CA', CA_ETA_VISAAI_ID)?.portalId).toBe('ircc-eta');
    expect(portalForRoute('CA', CA_SPOUSAL_VISAAI_ID)?.portalId).toBe(
      'ircc-pr-family',
    );
    for (const [portal, visa] of [
      ['ircc', TRV],
      ['ircc', SUPER],
      ['ircc', BUSINESS],
      ['ircc-eta', CA_ETA_VISAAI_ID],
      ['ircc-pr-family', CA_SPOUSAL_VISAAI_ID],
    ] as const) {
      const m = resolvePortalFillFor(portal, visa)!;
      expect(m).toBeDefined();
      for (const f of m) {
        expect(f.page).not.toBe(EAPP_PAGE);
        expect(f.profileKey).not.toMatch(/^eapp_/);
      }
    }
  });

  it('the shared page may be registered twice only with the same page info', () => {
    expect(() =>
      registerPortalFill('ircc-eapp-test-clash', [], {
        pages: [
          { page: EAPP_PAGE, title: 'Something else', progressive: true },
        ],
      }),
    ).toThrow(/registered by both/);
    expect(() =>
      registerPortalFill('ircc-eapp-test-clash', [], {
        pages: [{ page: EAPP_PAGE, title: EAPP_PAGES[0].title }],
      }),
    ).toThrow(/registered by both/);
  });
});
