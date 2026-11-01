/**
 * The portal is chosen by ROUTE, not by country alone: a Canada application
 * whose visa type is the eTA fills the eTA form ('ircc-eta'); every other
 * Canada route keeps filling IRCC tr-rt ('ircc').
 */
import { PreflightMappingService } from '../src/modules/preflight/preflight-mapping.service';
import type { PrefillFormStore } from '../src/modules/preflight/prefill-form.store';
import type { SupabaseService } from '../src/modules/shared/supabase/supabase.service';
import { portalForRoute, strategyRegistry } from '../src/strategies';
import '../src/modules/automation/portal-fills/canada-ircc';
import '../src/modules/automation/portal-fills/canada-ircc-eta';

const ETA = 'ca-electronic-travel-authorization-eta';

describe('portalForRoute', () => {
  it('Canada + eTA visa type → the eTA portal', () => {
    const p = portalForRoute('CA', ETA);
    expect(p?.portalId).toBe('ircc-eta');
    expect(p?.assistedFill).toBe(true);
    expect(p?.portalUrl).toMatch(/\/eta\/welcome/);
  });

  it('every other Canada route keeps IRCC tr-rt', () => {
    for (const v of [null, undefined, 'ca-visitor-visa-trv', 'ca-super-visa'])
      expect(portalForRoute('CA', v)?.portalId).toBe('ircc');
    expect(portalForRoute('CA', ETA)).not.toEqual(
      strategyRegistry.getCountry('CA')?.portal(),
    );
    expect(strategyRegistry.getCountry('CA')?.portal().portalId).toBe('ircc');
  });

  it('other countries are unchanged, whatever the visa type', () => {
    expect(portalForRoute('GB', ETA)?.portalId).toBe(
      strategyRegistry.getCountry('GB')?.portal().portalId,
    );
    expect(portalForRoute('ZZ', ETA)).toBeUndefined();
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

function service(app: Record<string, unknown>) {
  return new PreflightMappingService(
    fakeSupabase({
      applications: app,
      application_profiles: {
        profile_json: {
          nationality: 'GBR',
          passport_number: '123456789',
          given_name: 'Jane',
          family_name: 'Smith',
          date_of_birth: '1960-05-01',
          purpose_of_visit: 'Tourism',
        },
      },
    }),
    { load: jest.fn().mockResolvedValue(null) } as unknown as PrefillFormStore,
    {
      notApplicableFieldKeys: () => Promise.resolve(new Set<string>()),
    } as never,
  );
}

describe('PreflightMappingService resolves the portal from the visa type', () => {
  it('an eTA application derives eTA writes', async () => {
    const m = await service({
      destination_country: 'CA',
      visa_types: { visaai_id: ETA },
    }).forApplication('app-1');
    expect(m.length).toBeGreaterThan(0);
    for (const i of m) expect(i.page).toBe('/eta/welcome');
    expect(m.map((i) => i.targetField)).toContain(
      '[id="applicationDetails.personalDetails_passportNumber"]',
    );
  });

  it('the embedded visa type may arrive as an array', async () => {
    const m = await service({
      destination_country: 'CA',
      visa_types: [{ visaai_id: ETA }],
    }).forApplication('app-1');
    for (const i of m) expect(i.page).toBe('/eta/welcome');
  });

  it('a visitor-visa application (or none recorded) still derives IRCC tr-rt writes', async () => {
    for (const vt of [
      null,
      { visaai_id: 'ca-visitor-visa-trv' },
      { visaai_id: null },
    ]) {
      const m = await service({
        destination_country: 'CA',
        visa_types: vt,
      }).forApplication('app-1');
      expect(m.some((i) => i.page === '/eta/welcome')).toBe(false);
      expect(m.some((i) => i.page === '/bio-data')).toBe(true);
    }
  });
});
