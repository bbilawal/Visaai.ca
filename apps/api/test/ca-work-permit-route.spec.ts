/**
 * A new work permit from outside Canada is applied for in the IRCC secure
 * account ("Apply to come to Canada" -> questionnaire -> IMM 1295), not on
 * tr-rt, and it is not a visit. Until 2026-10-29 no program claimed the
 * route, so it fell back to the visitor visa everywhere: tr-rt fill steps at
 * Launch ("Visitor visa" ticked), a trip purpose and travel dates in the
 * interview, visitor letters, and every Canada form template (IMM 5257).
 */
import {
  CA_EE_VISAAI_ID,
  CA_SPOUSAL_VISAAI_ID,
  CA_STUDY_VISAAI_ID,
  CA_WORK_VISAAI_ID,
  intakeFactSpecs,
  isWorkPermitRoute,
  missingIntakeFacts,
  offeredGenTypesForRoute,
  requiredGenTypesForRoute,
  routeHasPortalFill,
} from '@visaai/types';
import { PreflightMappingService } from '../src/modules/preflight/preflight-mapping.service';
import type { PrefillFormStore } from '../src/modules/preflight/prefill-form.store';
import type { SupabaseService } from '../src/modules/shared/supabase/supabase.service';
import { portalForRoute, strategyRegistry } from '../src/strategies';
import { documentTemplatesForRoute } from '../src/modules/doc-templates/doc-template.catalog';
import {
  routeRiskWeights,
  DEFAULT_RISK_WEIGHTS,
} from '../src/modules/vri/risk-config.types';
import { finalizeFields } from '../src/modules/prefill/graphs/nodes/finalize-fields';
import { routeKeysDirective } from '../src/modules/prefill/graphs/nodes/generate-fields';
import {
  docInstruction,
  routeDirective,
} from '../src/modules/narrative/graphs/nodes/draft-document';
import '../src/modules/automation/portal-fills/canada-ircc';
import '../src/modules/automation/portal-fills/canada-ircc-eta';

const TRV = 'ca-visitor-visa-temporary-resident-visa';
const ETA = 'ca-electronic-travel-authorization-eta';
const SUPER = 'ca-super-visa';
const ctx = { country: 'CA', visaaiId: CA_WORK_VISAAI_ID };
const missing = (p: Record<string, unknown>) =>
  missingIntakeFacts(p, ctx).map((f) => f.key);

describe('work permit route', () => {
  it('is its own route id', () => {
    expect(CA_WORK_VISAAI_ID).toBe('ca-work-permit');
    expect(isWorkPermitRoute(' ca-work-permit ')).toBe(true);
    expect(isWorkPermitRoute(CA_STUDY_VISAAI_ID)).toBe(false);
    expect(isWorkPermitRoute(null)).toBe(false);
  });

  it('resolves to the work permit program with the Canada settings', () => {
    const r = strategyRegistry.resolveRoute('CA', CA_WORK_VISAAI_ID);
    expect(r?.program.id).toBe('work_permit');
    expect(r?.program.interviewGuidance?.()).toMatch(/WORK PERMIT/);
    expect(r?.program.interviewGuidance?.()).toMatch(/IMM 1295/);
    expect(r?.program.checklistSupplement).toBe(false);
    expect(r?.program.requiredGeneratedDocuments?.()).toEqual([]);
    expect(r?.program.forms?.().map((f) => f.formCode)).toEqual([
      'IMM 1295',
      'IMM 5645',
    ]);
    // Other countries' work permit programs stay generic.
    for (const c of ['GB', 'AU', 'US'])
      expect(strategyRegistry.resolveRoute(c, CA_WORK_VISAAI_ID)).toBeUndefined();
  });

  it('gets the work permit form templates, never the visitor visa ones', () => {
    const r = strategyRegistry.resolveRoute('CA', CA_WORK_VISAAI_ID)!;
    const codes = documentTemplatesForRoute(
      'CA',
      r.program,
      CA_WORK_VISAAI_ID,
    ).map((t) => t.templateCode);
    expect(codes).not.toContain('IMM 5257');
    expect(codes).not.toContain('IMM 1294');
  });

  it('fills its own secure-account questionnaire: not tr-rt, whose visitor mapping would tick "Visitor visa"', () => {
    const p = portalForRoute('CA', CA_WORK_VISAAI_ID);
    expect(p?.portalId).toBe('ircc-work');
    // On since the Work branch was recorded live (2026-10-30).
    expect(p?.assistedFill).toBe(true);
    // Every other Canada route is unchanged.
    expect(portalForRoute('CA', TRV)?.portalId).toBe('ircc');
    expect(portalForRoute('CA', TRV)?.assistedFill).toBe(true);
    expect(portalForRoute('CA', SUPER)?.portalId).toBe('ircc');
    expect(portalForRoute('CA', ETA)?.portalId).toBe('ircc-eta');
    expect(portalForRoute('CA', CA_EE_VISAAI_ID)?.portalId).toBe('ircc-ee');
    expect(portalForRoute('CA', CA_EE_VISAAI_ID)?.assistedFill).toBe(false);
    expect(portalForRoute('CA', CA_SPOUSAL_VISAAI_ID)?.portalId).toBe(
      'ircc-pr-family',
    );
    expect(portalForRoute('CA', CA_STUDY_VISAAI_ID)?.portalId).toBe(
      'ircc-study',
    );
    expect(portalForRoute('CA', CA_STUDY_VISAAI_ID)?.assistedFill).toBe(true);
  });

  it('the web app shows Launch for it; only Express Entry keeps the manual route', () => {
    expect(routeHasPortalFill(CA_EE_VISAAI_ID)).toBe(false);
    for (const v of [
      CA_WORK_VISAAI_ID,
      TRV,
      ETA,
      SUPER,
      'ca-business-visitors',
      CA_STUDY_VISAAI_ID,
      CA_SPOUSAL_VISAAI_ID,
      null,
    ])
      expect(routeHasPortalFill(v)).toBe(true);
  });

  it('the interview asks the work, not a trip and not a study', () => {
    const keys = intakeFactSpecs(ctx).map((f) => f.key);
    for (const k of [
      'purpose_of_visit',
      'duration_of_stay_days',
      'planned_entry_date',
      'planned_departure_date',
      'inviter_name',
      'trip_expenses_paid_by',
      // Study facts.
      'dli_number',
      'study_school_name',
      'study_program',
      'has_attestation_letter',
      'tuition_cad',
      'caq_number',
      'custodian',
      'exchange_student',
      'work_essential_to_studies',
      'study_funds_available_cad',
    ])
      expect(keys).not.toContain(k);
    expect(keys).toEqual(
      expect.arrayContaining([
        'work_permit_type',
        'public_policy_or_special_measure',
        'work_employer_name',
        'work_job_title',
        'work_location_province',
        'work_start_date',
        'work_end_date',
        'lmia_number',
        'offer_of_employment_number',
        'work_caq_number',
        'public_health_occupation',
        'principal_relationship',
        // The current job and history stay under their own keys.
        'job_title',
        'employer_name',
        'work_history',
        'education_history',
        'siblings',
        'previous_countries_of_residence',
        'previous_relationships',
        'language_test_type',
        'refused_or_ordered_to_leave',
        'refusal_details',
        'health_services_disorder',
      ]),
    );
    expect(new Set(keys).size).toBe(keys.length);
    // No spec's alias may be another spec's key on this route.
    const specs = intakeFactSpecs(ctx);
    for (const f of specs)
      for (const a of f.aliases ?? []) expect(keys).not.toContain(a);
  });

  it('every work question has a Forms page label', () => {
    for (const f of intakeFactSpecs(ctx).filter((s) => s.key !== 'employed'))
      expect(f.form?.label).toBeTruthy();
  });

  it('an LMIA job asks the LMIA number, never the offer number or the family member', () => {
    const m = missing({ work_permit_type: 'lmia', work_location_province: 'Ontario' });
    expect(m).toEqual(
      expect.arrayContaining(['lmia_number', 'work_employer_name', 'work_job_title']),
    );
    for (const k of ['offer_of_employment_number', 'work_caq_number', 'principal_relationship', 'principal_name'])
      expect(m).not.toContain(k);
    // A CAQ only for an LMIA job in Quebec.
    expect(missing({ work_permit_type: 'lmia', work_location_province: 'Québec' })).toContain('work_caq_number');
    expect(missing({ work_permit_type: 'lmia_exempt', work_location_province: 'Quebec' })).not.toContain('work_caq_number');
    expect(missing({ work_permit_type: 'open', work_location_province: 'Quebec' })).not.toContain('work_caq_number');
    // A malformed LMIA number is asked again.
    expect(missing({ work_permit_type: 'lmia', lmia_number: '12345' })).toContain('lmia_number');
    expect(missing({ work_permit_type: 'lmia', lmia_number: '1234567' })).not.toContain('lmia_number');
    // The extractor can store the number as a JSON number: still answered.
    expect(missing({ work_permit_type: 'lmia', lmia_number: 1234567 })).not.toContain('lmia_number');
    // A category with no number (IMM 1295 leaves it blank) is not re-asked.
    expect(missing({ work_permit_type: 'lmia', lmia_number: 'not required' })).not.toContain('lmia_number');
    // SAWP is an LMIA stream.
    expect(missing({ work_permit_type: 'sawp' })).toContain('lmia_number');
  });

  it('asks whether the job offer is permanent or temporary for an employer-specific permit only', () => {
    expect(missing({ work_permit_type: 'lmia' })).toContain('job_offer_status');
    expect(missing({ work_permit_type: 'lmia_exempt' })).toContain('job_offer_status');
    expect(missing({ work_permit_type: 'open' })).not.toContain('job_offer_status');
    expect(missing({ work_permit_type: 'lmia', job_offer_status: 'temporary' })).not.toContain('job_offer_status');
  });

  it('an LMIA-exempt job asks the offer of employment number (A + 7 digits), never the LMIA number', () => {
    const m = missing({ work_permit_type: 'lmia_exempt' });
    expect(m).toContain('offer_of_employment_number');
    expect(m).toContain('work_employer_name');
    expect(m).not.toContain('lmia_number');
    expect(m).not.toContain('principal_relationship');
    expect(missing({ work_permit_type: 'LMIA-exempt', offer_of_employment_number: '1234567' })).toContain('offer_of_employment_number');
    expect(missing({ work_permit_type: 'LMIA-exempt', offer_of_employment_number: 'A1234567' })).not.toContain('offer_of_employment_number');
  });

  it('an open work permit asks the family member, never the employer, job or numbers', () => {
    const m = missing({ work_permit_type: 'open' });
    for (const k of [
      'work_employer_name',
      'work_employer_address',
      'work_location_province',
      'work_location_address',
      'work_job_title',
      'work_job_duties',
      'lmia_number',
      'offer_of_employment_number',
      'work_caq_number',
    ])
      expect(m).not.toContain(k);
    expect(m).toEqual(
      expect.arrayContaining(['principal_relationship', 'principal_name', 'principal_status_in_canada', 'work_start_date', 'work_end_date']),
    );
    // The principal's job only for a worker, their program only for a student.
    const worker = missing({ work_permit_type: 'open', principal_relationship: 'spouse of a worker' });
    expect(worker).toContain('principal_job_title_and_noc');
    expect(worker).not.toContain('principal_study_program');
    // Stored spellings: underscores and hyphens.
    for (const t of ['open_work_permit', 'spousal_owp', 'spousal-open-work-permit']) {
      const o = missing({ work_permit_type: t });
      expect(o).not.toContain('work_employer_name');
      expect(o).toContain('principal_relationship');
    }
    const student = missing({ work_permit_type: 'open', principal_relationship: 'spouse of a student' });
    expect(student).toContain('principal_study_program');
    expect(student).not.toContain('principal_job_title_and_noc');
  });

  it('never blocks on a work end date past the passport expiry, and keeps declarations explicit', () => {
    // The job's real end date is the answer; IRCC caps the permit itself.
    expect(
      missing({ work_end_date: '2030-01-01', passport_expiry_date: '2029-06-30' }),
    ).not.toContain('work_end_date');
    expect(
      missing({ work_end_date: '2028-01-01', passport_expiry_date: '2029-06-30' }),
    ).not.toContain('work_end_date');
    const specs = intakeFactSpecs(ctx);
    const spec = (k: string) => specs.find((f) => f.key === k)!;
    const policy = spec('public_policy_or_special_measure');
    expect(policy.askedBy!.test(policy.question)).toBe(true);
    expect(policy.askedBy!.test('What is the purpose of the trip?')).toBe(false);
    const disorder = spec('health_services_disorder');
    expect(disorder.askedBy!.test(disorder.question)).toBe(true);
    // Nothing is defaulted: an empty profile is asked every declaration.
    const m = missing({});
    for (const k of ['public_policy_or_special_measure', 'refused_or_ordered_to_leave', 'committed_crime', 'health_services_disorder', 'military_service'])
      expect(m).toContain(k);
    // The background block is the study permit's, word for word.
    const study = intakeFactSpecs({ country: 'CA', visaaiId: CA_STUDY_VISAAI_ID });
    for (const k of ['refused_or_ordered_to_leave', 'committed_crime', 'health_services_disorder', 'ill_treatment'])
      expect(spec(k).question).toBe(study.find((f) => f.key === k)!.question);
  });

  it("adding the work permit changes no other route's interview", () => {
    for (const v of [
      TRV,
      ETA,
      SUPER,
      'ca-business-visitors',
      CA_EE_VISAAI_ID,
      CA_SPOUSAL_VISAAI_ID,
      CA_STUDY_VISAAI_ID,
    ]) {
      const keys = intakeFactSpecs({ country: 'CA', visaaiId: v }).map(
        (f) => f.key,
      );
      for (const k of [
        'work_permit_type',
        'lmia_number',
        'offer_of_employment_number',
        'work_caq_number',
        'principal_relationship',
        'public_policy_or_special_measure',
      ])
        expect(keys).not.toContain(k);
    }
    // EE's language test question is unchanged.
    const ee = intakeFactSpecs({ country: 'CA', visaaiId: CA_EE_VISAAI_ID }).find(
      (f) => f.key === 'language_test_type',
    );
    expect(ee?.question).toMatch(/^Which approved language test did you take/);
  });

  it('offers a cover letter and an LOE, requires none, written from the work briefs', () => {
    expect(offeredGenTypesForRoute(ctx)).toEqual(['cover_letter', 'loe']);
    expect(requiredGenTypesForRoute(ctx)).toEqual([]);
    const narrative = {
      visaaiId: CA_WORK_VISAAI_ID,
      profile: {
        work_permit_type: 'lmia',
        work_employer_name: 'Maple Test Foods Inc.',
        work_job_title: 'Food service supervisor',
        work_location_province: 'Alberta',
        lmia_number: '1234567',
        // The CURRENT job's start (OCR of the employment letter): never the Canada work start.
        employment_start_date: '2019-04-01',
      },
    } as never;
    for (const t of ['loe', 'cover_letter'] as const) {
      expect(docInstruction(narrative, t)).toMatch(/work permit/);
      expect(docInstruction(narrative, t)).not.toMatch(/purpose of travel/);
    }
    const d = routeDirective(narrative, 'loe');
    expect(d).toMatch(/Employer in Canada: Maple Test Foods Inc\./);
    expect(d).toMatch(/LMIA number: 1234567/);
    expect(d).toMatch(/not a visitor visa/);
    expect(d).not.toMatch(/2019-04-01/);
    expect(d).not.toMatch(/Offer of employment number/);
    // Visitor and study routes keep their own briefs.
    expect(
      docInstruction({ visaaiId: TRV, profile: {} } as never, 'loe'),
    ).toMatch(/purpose of travel/);
    expect(
      docInstruction({ visaaiId: CA_STUDY_VISAAI_ID, profile: {} } as never, 'loe'),
    ).toMatch(/study plan/);
  });

  it('readiness keeps the employment weight: a work permit is decided on the job', () => {
    const w = routeRiskWeights(DEFAULT_RISK_WEIGHTS, 'CA', CA_WORK_VISAAI_ID);
    expect(w.employment_pct).toBe(DEFAULT_RISK_WEIGHTS.employment_pct);
    expect(w.employment_pct).toBeGreaterThan(0);
  });
});

function fakeSupabase(rows: Record<string, unknown>): SupabaseService {
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq']) chain[m] = () => chain;
    chain.single = () =>
      Promise.resolve({ data: rows[table] ?? null, error: null });
    return chain;
  };
  return { admin: { from } } as unknown as SupabaseService;
}

describe('a work permit application gets no visitor-visa writes', () => {
  it('derives only the work questionnaire: no tr-rt, eTA or study writes', async () => {
    const svc = new PreflightMappingService(
      fakeSupabase({
        applications: {
          destination_country: 'CA',
          visa_types: { visaai_id: CA_WORK_VISAAI_ID },
        },
        application_profiles: {
          profile_json: {
            nationality: 'PAK',
            passport_number: 'AB1234567',
            given_name: 'Test',
            family_name: 'Applicant',
            date_of_birth: '1990-01-01',
            marital_status: 'Married',
            purpose_of_visit: 'Work',
          },
        },
      }),
      {
        load: jest.fn().mockResolvedValue(null),
      } as unknown as PrefillFormStore,
      {
        notApplicableFieldKeys: () => Promise.resolve(new Set<string>()),
      } as never,
    );
    const rows = (await svc.forApplication('app-work')) as Array<{
      fieldKey: string;
      targetField: string;
      mappedValue: unknown;
      page?: string;
    }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.page).toBe('/eapp/eapp');
      expect(r.targetField).not.toMatch(/7120/);
      expect(String(r.mappedValue)).not.toBe('7120');
    }
    const keys = rows.map((r) => r.fieldKey);
    expect(rows.find((r) => r.fieldKey === 'eapp_purpose')?.mappedValue).toBe('7123');
    expect(keys).toContain('eapp_marital_status');
    for (const k of ['eapp_attestation_letter', 'eapp_accepted_to_dli', 'eapp_post_secondary'])
      expect(keys).not.toContain(k);
  });
});

describe('the work permit Forms page has no visitor trip fields', () => {
  const field = (key: string, value = '') => ({
    key,
    label: key,
    value,
    group: 'Travel',
    source: 'profile' as const,
  });
  const formCtx = (visaaiId: string) => ({
    applicantName: null,
    profile: {},
    documentFields: {},
    documentFieldsByType: {},
    otherPartyDocuments: [],
    accountProfile: {},
    route: { country: 'CA', visaaiId },
  });

  it('drops empty trip fields, keeps a written value and the work dates', () => {
    const keys = finalizeFields(
      [
        field('intended_date_of_arrival'),
        field('intended_duration_of_stay_days'),
        field('trip_funds_cad'),
        field('work_start_date', '2027-03-01'),
        field('work_funds_available_cad', '8000'),
        { ...field('intended_arrival_note', 'typed by the applicant'), source: 'applicant' as const },
      ],
      formCtx(CA_WORK_VISAAI_ID),
    ).map((f) => f.key);
    expect(keys).not.toContain('intended_date_of_arrival');
    expect(keys).not.toContain('intended_duration_of_stay_days');
    expect(keys).not.toContain('trip_funds_cad');
    expect(keys).toContain('work_start_date');
    expect(keys).toContain('work_funds_available_cad');
    expect(keys).toContain('intended_arrival_note');
  });

  it('drops trip fields the generator FILLED with the work dates, keeps typed ones (live E2E 2026-10-30)', () => {
    const typed = { ...field('intended_exit_date', '2029-01-10'), source: 'applicant' as const };
    const keys = finalizeFields(
      [
        field('purpose_of_visit', 'Work from January 11, 2027 to January 10, 2029'),
        field('intended_entry_date', '2027-01-11'),
        field('intended_duration_days', '731'),
        field('duration_of_stay_days', '731'),
        field('currency_of_funds', 'CAD'),
        typed,
      ],
      formCtx(CA_WORK_VISAAI_ID),
    ).map((f) => f.key);
    for (const k of ['purpose_of_visit', 'intended_entry_date', 'intended_duration_days', 'duration_of_stay_days', 'currency_of_funds'])
      expect(keys).not.toContain(k);
    expect(keys).toContain('intended_exit_date');
  });

  it('the generator\'s own work keys are the work questions, not duplicate rows', () => {
    const ctx = {
      ...formCtx(CA_WORK_VISAAI_ID),
      profile: {
        work_permit_type: 'lmia',
        work_employer_name: 'Maple Test Logistics Inc.',
        work_job_title: 'Logistics Coordinator',
        work_start_date: '2027-01-11',
      },
    };
    const keys = finalizeFields(
      [
        field('work_permit_program', 'LMIA-based work permit'),
        field('employer_name_in_canada', 'Maple Test Logistics Inc.'),
        field('job_title_in_canada', 'Logistics Coordinator'),
        field('employment_start_date_in_canada', '2027-01-11'),
      ],
      ctx,
    ).map((f) => f.key);
    for (const k of ['work_permit_type', 'work_employer_name', 'work_job_title', 'work_start_date'])
      expect(keys).not.toContain(k);
  });

  it('drops empty rows for work questions this applicant is not asked, keeps the ones still asked (live E2E 2026-10-30)', () => {
    const ctx = { ...formCtx(CA_WORK_VISAAI_ID), profile: { work_permit_type: 'lmia', work_location_province: 'Ontario' } };
    const typed = { ...field('principal_name', 'typed anyway'), source: 'applicant' as const };
    const keys = finalizeFields(
      [
        field('offer_of_employment_number'),
        field('work_caq_number'),
        field('principal_relationship'),
        field('committed_crime_details'),
        field('lmia_number'),
        field('committed_crime'),
        typed,
      ],
      ctx,
    ).map((f) => f.key);
    for (const k of ['offer_of_employment_number', 'work_caq_number', 'principal_relationship', 'committed_crime_details'])
      expect(keys).not.toContain(k);
    for (const k of ['lmia_number', 'committed_crime', 'principal_name']) expect(keys).toContain(k);
  });

  it('a visitor visa keeps its trip fields', () => {
    const keys = finalizeFields(
      [field('purpose_of_visit', 'Tourism'), field('intended_entry_date', '2027-01-11')],
      formCtx('ca-visitor-visa-temporary-resident-visa'),
    ).map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(['purpose_of_visit', 'intended_entry_date']));
  });

  it('asks the unanswered work questions on the Forms page', () => {
    const keys = finalizeFields([], formCtx(CA_WORK_VISAAI_ID)).map(
      (f) => f.key,
    );
    expect(keys).toEqual(
      expect.arrayContaining(['work_permit_type', 'work_start_date', 'public_policy_or_special_measure']),
    );
    for (const k of ['dli_number', 'study_school_name', 'purpose_of_visit'])
      expect(keys).not.toContain(k);
  });
});

describe('the form generator is told the work questions\' keys', () => {
  it('lists the work keys on the work route only', () => {
    const d = routeKeysDirective('CA', CA_WORK_VISAAI_ID);
    expect(d).toMatch(/- work_employer_name: Name of employer/);
    expect(d).toMatch(/- lmia_number: /);
    expect(d).not.toMatch(/dli_number/);
    // Visitor routes and the eTA: no directive, so their generated keys are unchanged.
    expect(routeKeysDirective('CA', 'ca-visitor-visa-temporary-resident-visa')).toBe('');
    expect(routeKeysDirective('CA', 'ca-super-visa')).toBe('');
    expect(routeKeysDirective('CA', 'ca-electronic-travel-authorization-eta')).toBe('');
    expect(routeKeysDirective(null, null)).toBe('');
    expect(d).toMatch(/Do not add a field just because it is listed/);
  });

  it('lists the study and spousal keys on those routes', () => {
    expect(routeKeysDirective('CA', 'ca-study-permit')).toMatch(/- dli_number: DLI number/);
    expect(routeKeysDirective('CA', 'ca-study-permit')).not.toMatch(/work_employer_name/);
    expect(routeKeysDirective('CA', 'ca-sponsor-your-spouse-partner-or-child')).toMatch(/- family_name: /);
  });
});
