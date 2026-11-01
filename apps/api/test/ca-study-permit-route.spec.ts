/**
 * A study permit from outside Canada is applied for in the IRCC secure
 * account (IMM 1294) since 2025-03-25, not on tr-rt, and it is not a visit.
 * Until 2026-10-20 no program claimed the route, so it fell back to the
 * visitor visa everywhere: tr-rt fill steps at Launch ("Visitor visa"
 * ticked), a trip purpose and travel dates in the interview, a student scored
 * as unemployed in readiness.
 */
import {
  CA_EE_VISAAI_ID,
  CA_SPOUSAL_VISAAI_ID,
  CA_STUDY_VISAAI_ID,
  intakeFactSpecs,
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
import {
  docInstruction,
  routeDirective,
} from '../src/modules/narrative/graphs/nodes/draft-document';
import '../src/modules/automation/portal-fills/canada-ircc';
import '../src/modules/automation/portal-fills/canada-ircc-eta';

const TRV = 'ca-visitor-visa-temporary-resident-visa';
const ETA = 'ca-electronic-travel-authorization-eta';
const SUPER = 'ca-super-visa';
const ctx = { country: 'CA', visaaiId: CA_STUDY_VISAAI_ID };

describe('study permit route', () => {
  it('resolves to the student program with the Canada settings', () => {
    const r = strategyRegistry.resolveRoute('CA', CA_STUDY_VISAAI_ID);
    expect(r?.program.id).toBe('student_visa');
    expect(r?.program.label).toBe('Study Permit');
    expect(r?.program.interviewGuidance?.()).toMatch(/STUDY PERMIT/);
    expect(r?.program.checklistSupplement).toBe(false);
    // Other countries' student programs stay generic.
    expect(
      strategyRegistry.resolveRoute('GB', CA_STUDY_VISAAI_ID),
    ).toBeUndefined();
  });

  it('gets the study permit form templates, never the visitor visa ones', () => {
    const r = strategyRegistry.resolveRoute('CA', CA_STUDY_VISAAI_ID)!;
    const codes = documentTemplatesForRoute(
      'CA',
      r.program,
      CA_STUDY_VISAAI_ID,
    ).map((t) => t.templateCode);
    expect(codes).not.toContain('IMM 5257');
  });

  it('fills the secure account questionnaire, never tr-rt (whose visitor mapping would tick "Visitor visa")', () => {
    const p = portalForRoute('CA', CA_STUDY_VISAAI_ID);
    expect(p?.portalId).toBe('ircc-study');
    expect(p?.assistedFill).toBe(true);
    expect(portalForRoute('CA', TRV)?.portalId).toBe('ircc');
    expect(portalForRoute('CA', SUPER)?.portalId).toBe('ircc');
    expect(portalForRoute('CA', ETA)?.portalId).toBe('ircc-eta');
    expect(portalForRoute('CA', CA_EE_VISAAI_ID)?.portalId).toBe('ircc-ee');
    expect(portalForRoute('CA', CA_SPOUSAL_VISAAI_ID)?.portalId).toBe(
      'ircc-pr-family',
    );
  });

  it('the web app offers Launch for it (2026-10-20) as for the visitor routes', () => {
    expect(routeHasPortalFill(CA_STUDY_VISAAI_ID)).toBe(true);
    expect(routeHasPortalFill(CA_EE_VISAAI_ID)).toBe(false);
    expect(routeHasPortalFill(CA_SPOUSAL_VISAAI_ID)).toBe(true);
    for (const v of [TRV, ETA, SUPER, 'ca-business-visitors', null])
      expect(routeHasPortalFill(v)).toBe(true);
  });

  it('the interview asks the study, not a trip', () => {
    const keys = intakeFactSpecs(ctx).map((f) => f.key);
    for (const k of [
      'purpose_of_visit',
      'duration_of_stay_days',
      'inviter_name',
      'available_funds_cad',
      'trip_expenses_paid_by',
    ])
      expect(keys).not.toContain(k);
    expect(keys).toEqual(
      expect.arrayContaining([
        'study_school_name',
        'dli_number',
        'study_program',
        'study_start_date',
        'study_end_date',
        'has_attestation_letter',
        'tuition_cad',
        'study_funds_available_cad',
        'refused_or_ordered_to_leave',
        'refusal_details',
        'siblings',
        'education_history',
        'work_history',
      ]),
    );
    expect(new Set(keys).size).toBe(keys.length);
    // No spec's alias may be another spec's key on this route.
    const specs = intakeFactSpecs(ctx);
    for (const f of specs)
      for (const a of f.aliases ?? []) expect(keys).not.toContain(a);
  });

  it('every study question has a Forms page label', () => {
    for (const f of intakeFactSpecs(ctx).filter((s) => s.key !== 'employed'))
      expect(f.form?.label).toBeTruthy();
  });

  it('asks the PAL number only with a letter, the CAQ only in Quebec, a custodian only for a minor', () => {
    const missing = (p: Record<string, unknown>) =>
      missingIntakeFacts(p, ctx).map((f) => f.key);
    expect(missing({ has_attestation_letter: 'Yes' })).toContain(
      'attestation_letter_number',
    );
    expect(
      missing({
        has_attestation_letter: "No - master's at a public university",
      }),
    ).not.toContain('attestation_letter_number');
    expect(missing({ study_province: 'Ontario' })).not.toContain('caq_number');
    expect(missing({ study_province: 'Québec' })).toContain('caq_number');
    expect(
      missing({ date_of_birth: '1989-11-22', study_start_date: '2027-01-11' }),
    ).not.toContain('custodian');
    expect(
      missing({ date_of_birth: '2011-03-01', study_start_date: '2027-01-11' }),
    ).toContain('custodian');
    expect(
      missing({ date_of_birth: '2010-01-01', study_start_date: '2027-01-11' }),
    ).not.toContain('custodian');
  });

  it('review fixes: no shared school or GIC alias, a worded PAL "yes", a declaration only when asked', () => {
    const specs = intakeFactSpecs(ctx);
    const spec = (k: string) => specs.find((f) => f.key === k)!;
    // school_name is employer_name's alias (a current school); a GIC is one part of the funds.
    expect(spec('study_school_name').aliases).not.toContain('school_name');
    expect(spec('study_funds_available_cad').aliases).not.toContain(
      'gic_amount_cad',
    );
    // The letter of acceptance OCR keys answer the DLI number and tuition.
    expect(spec('dli_number').aliases).toContain('institution_id');
    expect(spec('tuition_cad').aliases).toContain('tuition_amount');
    const missing = (p: Record<string, unknown>) =>
      missingIntakeFacts(p, ctx).map((f) => f.key);
    expect(missing({ has_attestation_letter: 'Yes, Ontario PAL' })).toContain(
      'attestation_letter_number',
    );
    expect(missing({ pal_or_tal: 'yes' })).toContain(
      'attestation_letter_number',
    );
    expect(
      missing({ date_of_birth: '01/05/2011', study_start_date: '2027-01-11' }),
    ).not.toContain('custodian');
    const disorder = spec('health_services_disorder');
    expect(disorder.askedBy!.test(disorder.question)).toBe(true);
    expect(
      disorder.askedBy!.test(
        'Have you had a medical exam in the last 12 months?',
      ),
    ).toBe(false);
  });

  it("asks what the secure account's eligibility questionnaire asks (live 2026-10-20)", () => {
    const keys = intakeFactSpecs(ctx).map((f) => f.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'exchange_student',
        'work_essential_to_studies',
        'government_scholarship',
        'family_member_canadian_status',
        'designated_country_six_months',
        'us_permanent_resident',
        'uses_representative',
        'biometrics_given',
        'medical_exam_last_12_months',
      ]),
    );
    const missing = (p: Record<string, unknown>) =>
      missingIntakeFacts(p, ctx).map((f) => f.key);
    expect(missing({ us_permanent_resident: 'No' })).not.toContain(
      'us_green_card_number',
    );
    expect(missing({ uses_representative: 'No' })).not.toContain(
      'representative_name',
    );
  });

  it("adding the study permit changes no other route's interview", () => {
    for (const v of [
      TRV,
      ETA,
      SUPER,
      'ca-business-visitors',
      CA_EE_VISAAI_ID,
      CA_SPOUSAL_VISAAI_ID,
    ]) {
      const keys = intakeFactSpecs({ country: 'CA', visaaiId: v }).map(
        (f) => f.key,
      );
      for (const k of [
        'dli_number',
        'study_school_name',
        'has_attestation_letter',
        'tuition_cad',
        'custodian',
      ])
        expect(keys).not.toContain(k);
    }
  });

  it('offers the study plan and a cover letter, written from the study briefs', () => {
    expect(offeredGenTypesForRoute(ctx)).toEqual(['loe', 'cover_letter']);
    expect(requiredGenTypesForRoute(ctx)).toEqual(['loe']);
    const narrative = {
      visaaiId: CA_STUDY_VISAAI_ID,
      profile: {
        study_school_name: 'Maple Test College',
        dli_number: 'O999999999999',
        study_city: 'Toronto',
        study_province: 'Ontario',
        tuition_cad: 18500,
      },
    } as never;
    expect(docInstruction(narrative, 'loe')).toMatch(/study plan/i);
    expect(docInstruction(narrative, 'loe')).not.toMatch(/purpose of travel/);
    expect(docInstruction(narrative, 'cover_letter')).toMatch(
      /letter of acceptance/,
    );
    const d = routeDirective(narrative, 'loe');
    expect(d).toMatch(/School: Maple Test College/);
    expect(d).toMatch(/City and province: Toronto, Ontario/);
    expect(d).toMatch(/not a visitor visa/);
    expect(d).not.toMatch(/Program end/);
    // Visitor routes keep the visitor brief.
    expect(
      docInstruction({ visaaiId: TRV, profile: {} } as never, 'loe'),
    ).toMatch(/purpose of travel/);
  });

  it('readiness does not score a student as unemployed', () => {
    const w = routeRiskWeights(DEFAULT_RISK_WEIGHTS, 'CA', CA_STUDY_VISAAI_ID);
    expect(w.employment_pct).toBe(0);
    expect(w.home_ties_pct).toBeGreaterThan(0);
    expect(w.financial_pct).toBeGreaterThan(0);
    expect(routeRiskWeights(DEFAULT_RISK_WEIGHTS, 'CA', TRV)).toEqual(
      DEFAULT_RISK_WEIGHTS,
    );
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

describe('a study permit application gets no visitor-visa writes', () => {
  it('derives only questionnaire (eapp) writes: no tr-rt or eTA ones', async () => {
    const svc = new PreflightMappingService(
      fakeSupabase({
        applications: {
          destination_country: 'CA',
          visa_types: { visaai_id: CA_STUDY_VISAAI_ID },
        },
        application_profiles: {
          profile_json: {
            nationality: 'PAK',
            passport_number: 'AB1234567',
            given_name: 'Test',
            family_name: 'Applicant',
            date_of_birth: '1990-01-01',
            marital_status: 'Married',
            purpose_of_visit: 'Study',
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
    const rows = await svc.forApplication('app-study');
    // The consultant reviews the questionnaire answers like any route's.
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.page).toBe('/eapp/eapp');
    expect(rows.map((r) => r.fieldKey)).toEqual(
      expect.arrayContaining([
        'eapp_purpose',
        'eapp_passport_code',
        'eapp_marital_status',
      ]),
    );
  });
});

describe('the study permit Forms page has no visitor trip fields', () => {
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

  it('drops empty trip and trip-funds fields, keeps a written value and the study dates', () => {
    const keys = finalizeFields(
      [
        field('intended_date_of_arrival'),
        field('intended_duration_of_stay_days'),
        field('available_funds_cad'),
        field('funds_available'),
        field('study_start_date', '2027-01-11'),
        field('study_funds_available_cad', '23448'),
        { ...field('intended_arrival_note', 'typed by the applicant'), source: 'applicant' as const },
        // Generator-filled, not typed: off IMM 1294, so it goes (2026-10-30).
        field('intended_length_of_stay_days', '365'),
      ],
      formCtx(CA_STUDY_VISAAI_ID),
    ).map((f) => f.key);
    expect(keys).not.toContain('intended_date_of_arrival');
    expect(keys).not.toContain('intended_duration_of_stay_days');
    expect(keys).not.toContain('available_funds_cad');
    expect(keys).not.toContain('funds_available');
    expect(keys).toContain('study_start_date');
    expect(keys).toContain('study_funds_available_cad');
    expect(keys).toContain('intended_arrival_note');
    expect(keys).not.toContain('intended_length_of_stay_days');
  });

  it('keeps a filled funds row under its own alias even though the omit pattern matches it (review 2026-10-30)', () => {
    const keys = finalizeFields(
      [field('funds_available_for_stay_cad', '45000')],
      formCtx(CA_STUDY_VISAAI_ID),
    ).map((f) => f.key);
    expect(keys).toContain('funds_available_for_stay_cad');
  });

  it("adds no duplicate beside the generator's own keys (live E2E 2026-10-20)", () => {
    const generated = [
      field('provincial_attestation_letter_available', 'Yes'),
      field('provincial_attestation_letter_number', 'ON-PAL-1'),
      field('tuition_cost_cad', '18500'),
      field('room_and_board_cost_cad', '15000'),
      field('funds_available_for_stay_cad', '45000'),
      field('study_school_address', '123 Test Ave'),
      field('refused_visa_or_ordered_to_leave', 'Yes'),
    ];
    const profile = {
      has_attestation_letter: 'Yes',
      attestation_letter_number: 'ON-PAL-1',
      tuition_cad: 18500,
      room_and_board_cad: 15000,
      study_funds_available_cad: 45000,
      school_address: '123 Test Ave',
      refused_or_ordered_to_leave: true,
    };
    const keys = finalizeFields(generated, {
      ...formCtx(CA_STUDY_VISAAI_ID),
      profile,
    }).map((f) => f.key);
    for (const k of [
      'has_attestation_letter',
      'attestation_letter_number',
      'tuition_cad',
      'room_and_board_cad',
      'study_funds_available_cad',
      'school_address',
      'refused_or_ordered_to_leave',
    ])
      expect(keys).not.toContain(k);
    // The TRV spec is unchanged.
    const trv = intakeFactSpecs({ country: 'CA', visaaiId: TRV }).find(
      (f) => f.key === 'refused_or_ordered_to_leave',
    );
    expect(trv?.aliases ?? []).not.toContain(
      'refused_visa_or_ordered_to_leave',
    );
  });

  it('an empty generator field under an alias takes the profile answer', () => {
    const out = finalizeFields([field('study_school_address')], {
      ...formCtx(CA_STUDY_VISAAI_ID),
      profile: { school_address: '123 Test Ave' },
    });
    const rows = out.filter(
      (f) => f.key === 'school_address' || f.key === 'study_school_address',
    );
    expect(rows).toEqual([
      expect.objectContaining({ key: 'school_address', value: '123 Test Ave' }),
    ]);
    // A value the applicant cleared stays cleared.
    const kept = finalizeFields(
      [{ ...field('study_school_address'), source: 'applicant' }],
      {
        ...formCtx(CA_STUDY_VISAAI_ID),
        profile: { school_address: '123 Test Ave' },
      },
    );
    expect(kept.find((f) => f.key === 'study_school_address')?.value).toBe('');
  });

  it("asks the spouse's name of a married applicant only", () => {
    const missing = (p: Record<string, unknown>) =>
      missingIntakeFacts(p, ctx).map((f) => f.key);
    expect(missing({ marital_status: 'Married' })).toContain('spouse_name');
    expect(missing({ marital_status: 'Married' })).toContain(
      'spouse_country_of_birth',
    );
    expect(missing({ marital_status: 'Single' })).not.toContain('spouse_name');
    expect(missing({ marital_status: 'Never married' })).not.toContain(
      'spouse_name',
    );
  });

  it('asks the unanswered study questions on the Forms page', () => {
    const keys = finalizeFields([], formCtx(CA_STUDY_VISAAI_ID)).map(
      (f) => f.key,
    );
    expect(keys).toEqual(
      expect.arrayContaining([
        'dli_number',
        'study_school_name',
        'has_attestation_letter',
      ]),
    );
  });
});

// Review of 04ba82ea: the spousal IMM 5406 wording of `siblings` is the
// spousal route's own; the study interview keeps its IMM 5645 question.
describe('study permit: its own brothers-and-sisters question', () => {
  it('keeps the IMM 5645 wording and shape', () => {
    const study = intakeFactSpecs(ctx).find((f) => f.key === 'siblings');
    expect(study?.question).toBe(
      'List your brothers and sisters (half and step included): full name, date of birth, country of birth, marital status and current address. Say "none" if you have none.',
    );
    const spousal = intakeFactSpecs({
      country: 'CA',
      visaaiId: CA_SPOUSAL_VISAAI_ID,
    }).find((f) => f.key === 'siblings');
    expect(spousal?.shape).toMatch(/"relationship"/);
  });
});
