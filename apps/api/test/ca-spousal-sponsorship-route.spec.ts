/**
 * Spousal sponsorship is permanent residence filed on IRCC's Permanent
 * Residence Portal, not a visit. Until 2026-10-19 no program claimed the
 * route, so it fell back to the visitor visa everywhere: tr-rt fill steps at
 * Launch, a trip purpose and travel dates in the interview, home ties and
 * funds in readiness.
 */
import {
  CA_EE_VISAAI_ID,
  CA_SPOUSAL_VISAAI_ID,
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
import '../src/modules/automation/portal-fills/canada-ircc';
import '../src/modules/automation/portal-fills/canada-ircc-eta';

const TRV = 'ca-visitor-visa-temporary-resident-visa';
const ETA = 'ca-electronic-travel-authorization-eta';
const SUPER = 'ca-super-visa';

describe('spousal sponsorship route', () => {
  it('resolves to its own program, not the Super Visa', () => {
    const r = strategyRegistry.resolveRoute('CA', CA_SPOUSAL_VISAAI_ID);
    expect(r?.program.id).toBe('spousal_sponsorship');
    expect(r?.program.interviewGuidance?.()).toMatch(/PERMANENT RESIDENCE/);
    expect(r?.program.assessEligibility).toBeUndefined();
    // The Super Visa program claims no registry route; adding this one must
    // not make it resolve to spousal sponsorship either.
    expect(strategyRegistry.resolveRoute('CA', SUPER)?.program.id).not.toBe(
      'spousal_sponsorship',
    );
  });

  it('splits documents between the applicant and the sponsor', () => {
    const docs = strategyRegistry
      .resolveRoute('CA', CA_SPOUSAL_VISAAI_ID)!
      .program.requiredDocuments();
    const owner = Object.fromEntries(docs.map((d) => [d.code, d.ownedBy]));
    expect(owner.passport).toBe('applicant');
    expect(owner.police_clearance).toBe('applicant');
    expect(owner.proof_of_status).toBe('sponsor');
    const codes = docs.map((d) => d.code);
    for (const visitorOnly of [
      'proof_of_funds',
      'travel_itinerary',
      'invitation_letter',
      'employment_letter',
    ])
      expect(codes).not.toContain(visitorOnly);
  });

  it('the checklist gets no visitor discovery and no visitor form templates', () => {
    const r = strategyRegistry.resolveRoute('CA', CA_SPOUSAL_VISAAI_ID)!;
    expect(r.program.checklistSupplement).toBe(false);
    expect(
      documentTemplatesForRoute('CA', r.program, CA_SPOUSAL_VISAAI_ID).map(
        (t) => t.templateCode,
      ),
    ).not.toEqual(expect.arrayContaining(['IMM 5257']));
  });

  it('files on its own portal, never tr-rt', () => {
    const p = portalForRoute('CA', CA_SPOUSAL_VISAAI_ID);
    expect(p?.portalId).toBe('ircc-pr-family');
    // Recorded live 2026-10-20 (portal-fills/canada-ircc-pr-family.ts).
    expect(p?.assistedFill).toBe(true);
    expect(p?.portalUrl).toBe('https://prson-srpel.apps.cic.gc.ca/en/login');
    expect(portalForRoute('CA', TRV)?.portalId).toBe('ircc');
    expect(portalForRoute('CA', SUPER)?.portalId).toBe('ircc');
    expect(portalForRoute('CA', ETA)?.portalId).toBe('ircc-eta');
    expect(portalForRoute('CA', CA_EE_VISAAI_ID)?.portalId).toBe('ircc-ee');
  });

  it('the web app shows Launch for it; Express Entry keeps the manual route', () => {
    expect(routeHasPortalFill(CA_SPOUSAL_VISAAI_ID)).toBe(true);
    expect(routeHasPortalFill(CA_EE_VISAAI_ID)).toBe(false);
    for (const v of [TRV, ETA, SUPER, 'ca-business-visitors', null])
      expect(routeHasPortalFill(v)).toBe(true);
  });

  it('the interview asks no trip questions', () => {
    const keys = intakeFactSpecs({
      country: 'CA',
      visaaiId: CA_SPOUSAL_VISAAI_ID,
    }).map((f) => f.key);
    for (const k of [
      'purpose_of_visit',
      'duration_of_stay_days',
      'planned_entry_date',
      'inviter_name',
    ])
      expect(keys).not.toContain(k);
  });

  it('asks the sponsor and the relationship, and never the visitor spouse_* questions', () => {
    const keys = intakeFactSpecs({
      country: 'CA',
      visaaiId: CA_SPOUSAL_VISAAI_ID,
    }).map((f) => f.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'relationship_type',
        'first_met_date',
        'sponsor_status',
        'sponsor_residential_address',
        'sponsor_eligibility_bars',
        'address_history',
        'refugee_claim_made',
        'work_history',
        'parents',
      ]),
    );
    // The applicant's spouse IS the sponsor: sponsor_* facts carry them.
    expect(keys.filter((k) => k.startsWith('spouse_'))).toEqual([]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("adding spousal sponsorship changes no other route's interview", () => {
    for (const v of [
      TRV,
      ETA,
      SUPER,
      'ca-business-visitors',
      CA_EE_VISAAI_ID,
    ]) {
      const keys = intakeFactSpecs({ country: 'CA', visaaiId: v }).map(
        (f) => f.key,
      );
      for (const k of [
        'sponsor_eligibility_bars',
        'first_met_date',
        'relationship_type',
        'address_history',
        'refugee_claim_made',
      ])
        expect(keys).not.toContain(k);
    }
  });

  it('a dependent child is not asked how the couple met', () => {
    const missing = missingIntakeFacts(
      { relationship_type: 'dependent child' },
      { country: 'CA', visaaiId: CA_SPOUSAL_VISAAI_ID },
    ).map((f) => f.key);
    for (const k of [
      'first_met_date',
      'living_together',
      'visits',
      'relationship_ceremonies',
    ])
      expect(missing).not.toContain(k);
    expect(missing).toContain('sponsor_status');
  });

  it('a couple living together is not asked about visits apart; a married couple is asked if it was arranged', () => {
    const missing = missingIntakeFacts(
      {
        relationship_type: 'spouse',
        marital_status: 'Married',
        living_together: 'Yes',
      },
      { country: 'CA', visaaiId: CA_SPOUSAL_VISAAI_ID },
    ).map((f) => f.key);
    expect(missing).not.toContain('visits');
    expect(missing).toContain('marriage_arranged');
    expect(missing).not.toContain('conjugal_relationship_start_date');
  });

  it('review fixes: separate criminal-group declarations, details follow a yes, never-married is not married', () => {
    const ctx = { country: 'CA', visaaiId: CA_SPOUSAL_VISAAI_ID };
    const specs = intakeFactSpecs(ctx);
    const keys = specs.map((f) => f.key);
    // No spec's alias may be another spec's key on this route.
    for (const f of specs)
      for (const a of f.aliases ?? []) expect(keys).not.toContain(a);
    const missing = (p: Record<string, unknown>) =>
      missingIntakeFacts(p, ctx).map((f) => f.key);
    expect(missing({ criminal_pattern_organization_member: 'No' })).toContain(
      'violent_organization_member',
    );
    expect(missing({ ever_convicted: 'Yes' })).toContain(
      'ever_convicted_details',
    );
    expect(
      missing({
        relationship_type: 'conjugal partner',
        marital_status: 'Never married',
      }),
    ).not.toContain('marriage_arranged');
    expect(
      missing({ sponsorship_relationship: 'dependent child' }),
    ).not.toContain('first_met_date');
    expect(
      missing({ sponsor_status: 'Canadian citizen by birth' }),
    ).not.toContain('sponsor_status_date');
    expect(missing({ sponsor_status: 'permanent resident' })).toContain(
      'sponsor_status_date',
    );
    const bars = specs.find((f) => f.key === 'sponsor_eligibility_bars')!;
    expect(bars.askedBy!.test(bars.question)).toBe(true);
    expect(bars.askedBy!.test('Is your sponsor on social assistance?')).toBe(
      false,
    );
  });

  it("offers no visitor letter (the Generate brief is a visitor's)", () => {
    const ctx = { country: 'CA', visaaiId: CA_SPOUSAL_VISAAI_ID };
    expect(offeredGenTypesForRoute(ctx)).toEqual([]);
    expect(requiredGenTypesForRoute(ctx)).toEqual([]);
    expect(
      requiredGenTypesForRoute({ country: 'CA', visaaiId: SUPER }),
    ).toContain('invitation_letter');
  });

  it('readiness weighs only documents and consistency', () => {
    const w = routeRiskWeights(
      DEFAULT_RISK_WEIGHTS,
      'CA',
      CA_SPOUSAL_VISAAI_ID,
    );
    expect(w.home_ties_pct).toBe(0);
    expect(w.travel_history_pct).toBe(0);
    expect(w.financial_pct).toBe(0);
    expect(w.employment_pct).toBe(0);
    expect(w.documentation_pct).toBeGreaterThan(0);
    expect(w.consistency_pct).toBeGreaterThan(0);
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

describe('a spousal sponsorship application gets no visitor-visa writes', () => {
  it('derives only Permanent Residence Portal writes, never tr-rt (or eTA)', async () => {
    const svc = new PreflightMappingService(
      fakeSupabase({
        applications: {
          destination_country: 'CA',
          visa_types: { visaai_id: CA_SPOUSAL_VISAAI_ID },
        },
        application_profiles: {
          profile_json: {
            nationality: 'PAK',
            passport_number: 'AB1234567',
            given_name: 'Test',
            family_name: 'Applicant',
            date_of_birth: '1990-01-01',
            marital_status: 'Married',
            purpose_of_visit: 'Family visit',
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
    const writes = await svc.forApplication('app-spousal');
    // The PR portal (portal-fills/canada-ircc-pr-family.ts), 2026-10-20.
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes)
      expect(w.page).toMatch(
        /^\/en\/application\/(profile\/\*|case\/\*\/(imm0008\/page[2-8]|imm5406|imm5669|imm5562))$/,
      );
    expect(writes.map((w) => w.fieldKey)).not.toContain('purpose_of_visit');
    expect(
      writes.find((w) => w.fieldKey === 'pr_family_name')?.mappedValue,
    ).toBe('Applicant');
  });
});

describe('the spousal Forms page has no visitor trip or settlement-funds fields', () => {
  const field = (key: string, value = '') => ({
    key,
    label: key,
    value,
    group: 'Travel',
    source: 'profile' as const,
  });
  const ctx = (visaaiId: string) => ({
    applicantName: null,
    profile: {},
    documentFields: {},
    documentFieldsByType: {},
    otherPartyDocuments: [],
    accountProfile: {},
    route: { country: 'CA', visaaiId },
  });
  const generated = () => [
    field('intended_date_of_arrival'),
    field('intended_duration_of_stay_days'),
    field('personal_funds_available'),
    field('marriage_date', '2023-01-01'),
  ];

  it('drops the empty ones on spousal sponsorship, keeps a written value', () => {
    const keys = finalizeFields(
      [...generated(), field('date_of_arrival_note', 'typed by the applicant')],
      ctx(CA_SPOUSAL_VISAAI_ID),
    ).map((f) => f.key);
    expect(keys).not.toContain('intended_date_of_arrival');
    expect(keys).not.toContain('intended_duration_of_stay_days');
    expect(keys).not.toContain('personal_funds_available');
    expect(keys).toContain('marriage_date');
    expect(keys).toContain('date_of_arrival_note');
  });

  it('keeps a real PR question that merely mentions an arrival', () => {
    const keys = finalizeFields(
      [field('date_of_arrival_in_canada'), field('travel_1_departure_date')],
      ctx(CA_SPOUSAL_VISAAI_ID),
    ).map((f) => f.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'date_of_arrival_in_canada',
        'travel_1_departure_date',
      ]),
    );
  });

  it('the sponsor being the account holder is not flagged', () => {
    const out = finalizeFields(
      [
        {
          key: 'sponsor_email',
          label: 'Sponsor: email',
          value: 'holder@example.com',
          group: 'Sponsor',
          source: 'profile' as const,
        },
        {
          key: 'email',
          label: 'Email',
          value: 'holder@example.com',
          group: 'Contact',
          source: 'profile' as const,
        },
      ],
      {
        ...ctx(CA_SPOUSAL_VISAAI_ID),
        applicantName: 'Test Applicant',
        accountProfile: {
          full_name: 'Sara Holder',
          email: 'holder@example.com',
        },
      },
    );
    expect(out.find((f) => f.key === 'sponsor_email')?.needsReview).toBeFalsy();
    expect(out.find((f) => f.key === 'email')?.needsReview).toBe(true);
  });

  it('a visitor route keeps them for the applicant to fill', () => {
    const keys = finalizeFields(generated(), ctx(TRV)).map((f) => f.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'intended_date_of_arrival',
        'personal_funds_available',
      ]),
    );
  });

  it('Express Entry drops the trip but keeps its settlement funds', () => {
    const keys = finalizeFields(generated(), ctx(CA_EE_VISAAI_ID)).map(
      (f) => f.key,
    );
    expect(keys).not.toContain('intended_date_of_arrival');
    expect(keys).toContain('personal_funds_available');
  });

  it("asks the sponsor's email on its own", () => {
    const keys = intakeFactSpecs({
      country: 'CA',
      visaaiId: CA_SPOUSAL_VISAAI_ID,
    }).map((f) => f.key);
    expect(keys).toEqual(
      expect.arrayContaining(['sponsor_phone', 'sponsor_email']),
    );
  });
});

describe('an applicant who skipped the interview still gets the spousal questions on the Forms page', () => {
  const ctx = (visaaiId: string, profile: Record<string, unknown> = {}) => ({
    applicantName: null,
    profile,
    documentFields: {},
    documentFieldsByType: {},
    otherPartyDocuments: [],
    accountProfile: {},
    route: { country: 'CA', visaaiId },
  });

  it('adds each unanswered question once, empty, with a note', () => {
    const out = finalizeFields([], ctx(CA_SPOUSAL_VISAAI_ID));
    const keys = out.map((f) => f.key);
    for (const k of [
      'relationship_type',
      'first_met_date',
      'sponsor_status',
      'sponsor_eligibility_bars',
      'refugee_claim_made',
      'address_history',
    ])
      expect(keys).toContain(k);
    expect(new Set(keys).size).toBe(keys.length);
    expect(out.every((f) => f.value === '')).toBe(true);
    // A details question waits for its "yes".
    expect(keys).not.toContain('refugee_claim_made_details');
  });

  it('does not repeat a question the generator already wrote under an alias or the same label', () => {
    const out = finalizeFields(
      [
        {
          key: 'sponsor_canadian_status',
          label: 'x',
          value: '',
          group: 'Sponsor',
          source: 'profile' as const,
        },
        {
          key: 'when_met',
          label: 'Date you first met in person',
          value: '2022-09-10',
          group: 'Relationship',
          source: 'profile' as const,
        },
      ],
      ctx(CA_SPOUSAL_VISAAI_ID),
    );
    expect(out.filter((f) => f.key === 'sponsor_status')).toHaveLength(0);
    expect(out.filter((f) => f.key === 'first_met_date')).toHaveLength(0);
  });

  it('an answered question is not added empty, and a dependent child is not asked how the couple met', () => {
    const keys = finalizeFields(
      [],
      ctx(CA_SPOUSAL_VISAAI_ID, {
        relationship_type: 'dependent child',
        sponsor_status: 'permanent resident',
      }),
    ).map((f) => f.key);
    expect(keys).not.toContain('first_met_date');
    expect(keys.filter((k) => k === 'sponsor_status')).toHaveLength(1);
  });

  it("drops the generator's empty applicant income and assets fields, keeps the sponsor's", () => {
    const f = (key: string) => ({
      key,
      label: key,
      value: '',
      group: 'Financial',
      source: 'profile' as const,
    });
    const keys = finalizeFields(
      [
        f('applicant_annual_income'),
        f('applicant_bank_balance'),
        f('financial_assets'),
        f('sponsor_annual_income'),
      ],
      ctx(CA_SPOUSAL_VISAAI_ID, { relationship_type: 'spouse' }),
    ).map((x) => x.key);
    expect(keys).not.toEqual(
      expect.arrayContaining(['applicant_annual_income']),
    );
    expect(keys).not.toContain('applicant_bank_balance');
    expect(keys).not.toContain('financial_assets');
    expect(keys).toContain('sponsor_annual_income');
  });

  it('a Yes typed on the Forms page opens its details question', () => {
    const keys = finalizeFields(
      [
        {
          key: 'ever_convicted',
          label: 'x',
          value: 'Yes',
          group: 'Background',
          source: 'applicant' as const,
        },
      ],
      ctx(CA_SPOUSAL_VISAAI_ID),
    ).map((f) => f.key);
    expect(keys).toContain('ever_convicted_details');
  });

  it('a generator synonym for phone or name is not asked again', () => {
    const keys = finalizeFields(
      [
        {
          key: 'telephone_number',
          label: 'Telephone number',
          value: '+92 300 0000000',
          group: 'Contact',
          source: 'profile' as const,
        },
        {
          key: 'applicant_family_name',
          label: 'Surname',
          value: 'TEST',
          group: 'Personal',
          source: 'profile' as const,
        },
      ],
      ctx(CA_SPOUSAL_VISAAI_ID),
    ).map((f) => f.key);
    expect(keys).not.toContain('phone_number');
    expect(keys).not.toContain('family_name');
  });

  it("the sponsor's funds fields are never dropped", () => {
    const f = (key: string) => ({
      key,
      label: key,
      value: '',
      group: 'Financial',
      source: 'profile' as const,
    });
    const keys = finalizeFields(
      [f('sponsor_funds_available'), f('sponsor_available_funds')],
      ctx(CA_SPOUSAL_VISAAI_ID),
    ).map((x) => x.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'sponsor_funds_available',
        'sponsor_available_funds',
      ]),
    );
  });

  it('other routes get no spousal questions added', () => {
    for (const v of [
      TRV,
      ETA,
      SUPER,
      'ca-business-visitors',
      CA_EE_VISAAI_ID,
    ]) {
      const keys = finalizeFields([], ctx(v)).map((x) => x.key);
      expect(keys).not.toContain('first_met_date');
      expect(keys).not.toContain('sponsor_eligibility_bars');
    }
  });
});

describe('spousal Forms page: visit dates and stray income', () => {
  const ctx = (profile: Record<string, unknown>) => ({
    applicantName: null,
    profile,
    documentFields: {},
    documentFieldsByType: {},
    otherPartyDocuments: [],
    accountProfile: {},
    route: { country: 'CA', visaaiId: CA_SPOUSAL_VISAAI_ID },
  });
  const f = (key: string, value = '') => ({
    key,
    label: key,
    value,
    group: 'Relationship',
    source: 'profile' as const,
  });

  it("fills each visit row's empty dates with the months the applicant gave", () => {
    const out = finalizeFields(
      [
        f('visit_1_start_date'),
        f('visit_1_end_date'),
        f('visit_2_start_date', '2024-06-03'),
        f('visit_3_end_date'),
      ],
      ctx({
        relationship_type: 'spouse',
        visits: [
          { from: '2023-12', to: '2024-01' },
          { from: '2024-06', to: '2024-08' },
        ],
      }),
    );
    const v = Object.fromEntries(out.map((x) => [x.key, x.value]));
    expect(v.visit_1_start_date).toBe('2023-12');
    expect(v.visit_1_end_date).toBe('2024-01');
    expect(v.visit_2_start_date).toBe('2024-06-03'); // a written value wins
    expect(v.visit_3_end_date).toBe(''); // no third visit
  });

  it('reads the visits aliases, and "present" is no end date', () => {
    const out = finalizeFields(
      [f('visit_1_start_date'), f('visit_1_end_date')],
      ctx({
        relationship_type: 'spouse',
        in_person_visits: [{ from: '2025-02', to: 'present' }],
      }),
    );
    const v = Object.fromEntries(out.map((x) => [x.key, x.value]));
    expect(v.visit_1_start_date).toBe('2025-02');
    expect(v.visit_1_end_date).toBe('');
  });

  it('drops an empty employment_income field', () => {
    const keys = finalizeFields(
      [{ ...f('employment_income'), group: 'Employment' }],
      ctx({ relationship_type: 'spouse' }),
    ).map((x) => x.key);
    expect(keys).not.toContain('employment_income');
  });
});
