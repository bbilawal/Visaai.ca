/**
 * Express Entry is a permanent-residence profile, not a visit. Until
 * 2026-10-19 no program claimed the route, so it fell back to the visitor visa
 * everywhere: tr-rt fill steps at Launch, a trip purpose and travel dates in
 * the interview, home ties in readiness.
 */
import {
  CA_EE_VISAAI_ID,
  intakeFactSpecs,
  offeredGenTypesForRoute,
  requiredGenTypesForRoute,
} from '@visaai/types';
import { PreflightMappingService } from '../src/modules/preflight/preflight-mapping.service';
import type { PrefillFormStore } from '../src/modules/preflight/prefill-form.store';
import type { SupabaseService } from '../src/modules/shared/supabase/supabase.service';
import { portalForRoute, strategyRegistry } from '../src/strategies';
import { routeRiskWeights, DEFAULT_RISK_WEIGHTS } from '../src/modules/vri/risk-config.types';
import '../src/modules/automation/portal-fills/canada-ircc';
import '../src/modules/automation/portal-fills/canada-ircc-eta';

const TRV = 'ca-visitor-visa-temporary-resident-visa';
const ETA = 'ca-electronic-travel-authorization-eta';

describe('Express Entry route', () => {
  it('resolves to its own program', () => {
    const r = strategyRegistry.resolveRoute('CA', CA_EE_VISAAI_ID);
    expect(r?.program.id).toBe('express_entry');
    expect(r?.program.interviewGuidance?.()).toMatch(/PERMANENT RESIDENCE/);
    expect(r?.program.assessEligibility).toBeUndefined();
  });

  it('the checklist is IRCC\'s list alone, no visitor discovery', () => {
    const r = strategyRegistry.resolveRoute('CA', CA_EE_VISAAI_ID);
    expect(r?.program.checklistSupplement).toBe(false);
    expect(
      strategyRegistry.resolveRoute('CA', TRV)?.program.checklistSupplement,
    ).not.toBe(false);
  });

  it('files on its own portal, never tr-rt', () => {
    const p = portalForRoute('CA', CA_EE_VISAAI_ID);
    expect(p?.portalId).toBe('ircc-ee');
    expect(p?.assistedFill).toBe(false);
    expect(portalForRoute('CA', TRV)?.portalId).toBe('ircc');
    expect(portalForRoute('CA', ETA)?.portalId).toBe('ircc-eta');
  });

  it('the interview asks no trip questions', () => {
    const keys = intakeFactSpecs({ country: 'CA', visaaiId: CA_EE_VISAAI_ID }).map((f) => f.key);
    expect(keys).not.toContain('purpose_of_visit');
    expect(keys).not.toContain('duration_of_stay_days');
    expect(keys).not.toContain('planned_entry_date');
    expect(keys).not.toContain('inviter_name');
    expect(keys).toEqual(
      expect.arrayContaining(['language_test_type', 'language_test_scores', 'has_eca', 'work_history', 'settlement_funds_cad']),
    );
  });

  it('adding Express Entry changes no other route\'s interview', () => {
    const ee = new Set(
      intakeFactSpecs({ country: 'CA', visaaiId: CA_EE_VISAAI_ID }).map((f) => f.key),
    );
    for (const v of [TRV, ETA, 'ca-super-visa', 'ca-business-visitors']) {
      const keys = intakeFactSpecs({ country: 'CA', visaaiId: v }).map((f) => f.key);
      for (const k of ['language_test_type', 'eca_number', 'has_provincial_nomination', 'settlement_funds_cad'])
        expect(keys).not.toContain(k);
      if (v !== ETA) expect(keys).toContain('purpose_of_visit');
    }
    expect(ee.size).toBeGreaterThan(0);
  });

  it('offers no visitor letter (the Generate brief is a visitor\'s)', () => {
    const ctx = { country: 'CA', visaaiId: CA_EE_VISAAI_ID };
    expect(offeredGenTypesForRoute(ctx)).toEqual([]);
    expect(requiredGenTypesForRoute(ctx)).toEqual([]);
  });

  it('readiness does not weigh home ties or travel history', () => {
    const w = routeRiskWeights(DEFAULT_RISK_WEIGHTS, 'CA', CA_EE_VISAAI_ID);
    expect(w.home_ties_pct).toBe(0);
    expect(w.travel_history_pct).toBe(0);
    expect(routeRiskWeights(DEFAULT_RISK_WEIGHTS, 'CA', TRV)).toEqual(DEFAULT_RISK_WEIGHTS);
  });
});

function fakeSupabase(rows: Record<string, unknown>): SupabaseService {
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq']) chain[m] = () => chain;
    chain.single = () => Promise.resolve({ data: rows[table] ?? null, error: null });
    return chain;
  };
  return { admin: { from } } as unknown as SupabaseService;
}

describe('an Express Entry application gets no visitor-visa writes', () => {
  it('derives no tr-rt (or eTA) writes', async () => {
    const svc = new PreflightMappingService(
      fakeSupabase({
        applications: { destination_country: 'CA', visa_types: { visaai_id: CA_EE_VISAAI_ID } },
        application_profiles: {
          profile_json: {
            nationality: 'PAK',
            passport_number: 'AB1234567',
            given_name: 'Test',
            family_name: 'Applicant',
            date_of_birth: '1990-01-01',
            purpose_of_visit: 'Tourism',
          },
        },
      }),
      { load: jest.fn().mockResolvedValue(null) } as unknown as PrefillFormStore,
      { notApplicableFieldKeys: () => Promise.resolve(new Set<string>()) } as never,
    );
    const m = await svc.forApplication('app-ee');
    expect(m).toEqual([]);
  });
});
