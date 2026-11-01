import { PreflightMappingService } from '../src/modules/preflight/preflight-mapping.service';
import type { PrefillFormStore } from '../src/modules/preflight/prefill-form.store';
import type { SupabaseService } from '../src/modules/shared/supabase/supabase.service';
import '../src/modules/automation/portal-fills/canada-ircc';
import '../src/modules/automation/portal-fills/canada-ircc-super-visa';

/** Table-routed service-role stub: `.single()` resolves the row for that table. */
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

const noneNotApplicable = {
  notApplicableFieldKeys: () => Promise.resolve(new Set<string>()),
} as never;

const PROFILE = {
  full_name: 'MUZAFFAR AHMAD',
  date_of_birth: '1961-06-15',
  passport_number: 'AK1182091',
  nationality: 'PAK',
  purpose_of_visit: 56,
  employed: false,
};

function make(
  formFields: { key: string; label: string; value: string }[] | null,
) {
  const store = {
    load: jest.fn().mockResolvedValue(
      formFields
        ? {
            id: 'gd-1',
            raw: '{}',
            payload: {
              visaType: 'trv',
              countryCode: 'CA',
              generatedAt: '',
              fields: formFields,
            },
          }
        : null,
    ),
  } as unknown as PrefillFormStore;
  const svc = new PreflightMappingService(
    fakeSupabase({
      applications: { destination_country: 'CA' },
      application_profiles: { profile_json: PROFILE },
    }),
    store,
    noneNotApplicable,
  );
  return svc;
}

describe('PreflightMappingService — the saved form is the source of mapped values', () => {
  it('reproduces prod 71ad0c29: the applicant-corrected 62 wins over the intake 56', async () => {
    const svc = make([
      { key: 'purpose_of_visit', label: 'Duration', value: '62' },
      { key: 'citizenship', label: 'Citizenship', value: 'Pakistan' },
    ]);
    const m = await svc.forApplication('app-1');
    expect(m.find((x) => x.fieldKey === 'purpose_of_visit')?.mappedValue).toBe(
      '62',
    );
    // nationality is not a form key -> falls back to the profile (PAK),
    // written as IRCC's country code
    expect(m.find((x) => x.fieldKey === 'nationality')?.mappedValue).toBe(
      '209',
    );
  });

  it('falls back to the profile entirely when no form has been saved', async () => {
    const m = await make(null).forApplication('app-1');
    expect(m.find((x) => x.fieldKey === 'purpose_of_visit')?.mappedValue).toBe(
      '56',
    );
  });

  it('is deterministic across calls (the lock depends on it)', async () => {
    const svc = make([{ key: 'purpose_of_visit', label: 'D', value: '62' }]);
    expect(await svc.forApplication('app-1')).toEqual(
      await svc.forApplication('app-1'),
    );
  });

  it("resolve() exposes the mapping so callers can find a field's category and label", async () => {
    const r = await make(null).resolve('app-1');
    expect(
      r.mapping?.find((f) => f.profileKey === 'purpose_of_visit')?.category,
    ).toBe('travel_history');
    expect(r.inputs.length).toBeGreaterThan(0);
  });
});

/**
 * #32: a field the consultant marked 'not applicable' is left out of what
 * auto-fill writes — so it is also out of the locked review — without blocking
 * the fill the way a rejection does.
 */
describe('PreflightMappingService — consultant "not applicable" fields', () => {
  it('drops every write for a not-applicable field and keeps the rest', async () => {
    const store = {
      load: jest.fn().mockResolvedValue(null),
    } as unknown as PrefillFormStore;
    const consultant = {
      notApplicableFieldKeys: jest
        .fn()
        .mockResolvedValue(new Set(['purpose_of_visit'])),
    };
    const svc = new PreflightMappingService(
      fakeSupabase({
        applications: { destination_country: 'CA' },
        application_profiles: { profile_json: PROFILE },
      }),
      store,
      consultant as never,
    );
    const all = await make(null).forApplication('app-1');
    expect(all.some((m) => m.fieldKey === 'purpose_of_visit')).toBe(true);

    const m = await svc.forApplication('app-1');
    expect(m.some((x) => x.fieldKey === 'purpose_of_visit')).toBe(false);
    expect(m).toEqual(all.filter((x) => x.fieldKey !== 'purpose_of_visit'));
    expect(consultant.notApplicableFieldKeys).toHaveBeenCalledWith('app-1');
  });
});

/**
 * A super visa (registry `ca-super-visa`) is filled on the same IRCC portal as
 * the visitor visa, with its own /purpose answers: the mapping follows the
 * application's registry visa type, not only its destination.
 */
describe('PreflightMappingService — the route picks the portal mapping', () => {
  const svc = (visaaiId: string | null) =>
    new PreflightMappingService(
      fakeSupabase({
        applications: {
          destination_country: 'CA',
          visa_types: visaaiId ? { visaai_id: visaaiId } : null,
        },
        application_profiles: { profile_json: PROFILE },
      }),
      {
        load: jest.fn().mockResolvedValue(null),
      } as unknown as PrefillFormStore,
      noneNotApplicable,
    );
  const purposeRadio = (m: { fieldKey: string }[]) =>
    m.some((x) => x.fieldKey === 'ircc_visa_purpose');

  it('a super visa application answers the super visa purpose', async () => {
    expect(purposeRadio(await svc('ca-super-visa').forApplication('a'))).toBe(
      true,
    );
    const cov = await svc('ca-super-visa').coverage('a');
    expect(cov?.pages.some((p) => p.page === '/doc-upload')).toBe(true);
  });

  it('a visitor visa (or no visa type) keeps the visitor mapping', async () => {
    expect(
      purposeRadio(
        await svc('ca-visitor-visa-temporary-resident-visa').forApplication(
          'a',
        ),
      ),
    ).toBe(false);
    expect(purposeRadio(await svc(null).forApplication('a'))).toBe(false);
  });
});

describe('PreflightMappingService — a failed application read is not "no portal fill"', () => {
  it('throws instead of returning no mappings (the approval gate must refuse)', async () => {
    const from = () => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq']) chain[m] = () => chain;
      chain.single = () =>
        Promise.resolve({ data: null, error: { message: 'connection reset' } });
      return chain;
    };
    const svc = new PreflightMappingService(
      { admin: { from } } as unknown as SupabaseService,
      {
        load: jest.fn().mockResolvedValue(null),
      } as unknown as PrefillFormStore,
      noneNotApplicable,
    );
    await expect(svc.forApplication('app-1')).rejects.toThrow(
      /Could not read the application/,
    );
  });
});
