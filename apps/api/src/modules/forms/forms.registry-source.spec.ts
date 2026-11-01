import '../../strategies';
import { FormsService } from './forms.service';
import type { FormTemplateStore, FormTemplateRow } from './form-template.store';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The forms an applicant is offered must match the route they CHOSE.
 *
 * `listForApplication` resolved them from `country_frameworks` or, failing
 * that, from the union of every program's forms for the destination country.
 * Neither reads `applications.visa_type_id`, so a Canadian study permit and a
 * Canadian visitor visa were handed the same list — while the registry has
 * held the real answer per visa type since it landed (IMM 1294/5409/5476 for
 * the study permit, IMM 5257/5475/5476/5645 for the TRV).
 */
function dbWith(opts: {
  visaTypeId: string | null;
  registryRows?: Array<Record<string, unknown>>;
  registryError?: { message: string };
  profile?: Record<string, unknown>;
}) {
  const app = {
    data: {
      id: 'app-1',
      visa_type_id: opts.visaTypeId,
      country_frameworks: null,
      destination_country: 'CA',
    },
    error: null,
  };

  return {
    from(table: string) {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        limit: () => chain,
        single: () => Promise.resolve(app),
        maybeSingle: () => Promise.resolve(app),
        order: () =>
          Promise.resolve(
            opts.registryError
              ? { data: null, error: opts.registryError }
              : { data: opts.registryRows ?? [], error: null },
          ),
      };
      if (table === 'application_profiles') {
        chain.maybeSingle = () =>
          Promise.resolve({ data: opts.profile ? { profile_json: opts.profile } : null, error: null });
      }
      if (table !== 'visa_requirements' && table !== 'applications') {
        chain.order = () => Promise.resolve({ data: [], error: null });
      }
      return chain;
    },
  } as unknown as SupabaseClient;
}

function store(row: Partial<FormTemplateRow> | null = null) {
  return {
    find: () => Promise.resolve(row as FormTemplateRow | null),
    findByFormCode: () => Promise.resolve(row as FormTemplateRow | null),
  } as unknown as FormTemplateStore;
}

const STUDY_PERMIT_ROWS = [
  {
    official_form_code: 'IMM 1294',
    official_form_url: 'https://www.canada.ca/imm1294',
    label: 'Application for Study Permit Made Outside of Canada',
    requirement_code: 'imm_1294',
  },
  {
    official_form_code: 'IMM 5409',
    official_form_url: null,
    label: 'Statutory Declaration of Common-law Union',
    requirement_code: 'imm_5409',
  },
];

describe('FormsService — official forms follow the selected visa type', () => {
  it('serves the registry forms for the chosen visa type', async () => {
    const svc = new FormsService(store());
    const forms = await svc.listForApplication(
      dbWith({ visaTypeId: 'visa-study', registryRows: STUDY_PERMIT_ROWS }),
      'app-1',
      'user-1',
    );

    expect(forms.map((f) => f.formCode)).toEqual(['IMM 1294', 'IMM 5409']);
    expect(forms[0].formName).toBe(
      'Application for Study Permit Made Outside of Canada',
    );
    expect(forms[0].officialUrl).toBe('https://www.canada.ca/imm1294');
    // No cached blank: the official page is the fallback, as before.
    expect(forms[0].source).toBe('official-link');
    expect(forms[0].downloadPath).toBeNull();
  });

  it('offers the cached blank when one exists, looked up by form code', async () => {
    const svc = new FormsService(
      store({
        status: 'ok',
        storage_path: 'CA/student_visa/imm-1294/01-09-2023.pdf',
        capability: 'acroform',
        version_label: '01-2023',
        last_verified_at: new Date().toISOString(),
      }),
    );

    const forms = await svc.listForApplication(
      dbWith({
        visaTypeId: 'visa-study',
        registryRows: [STUDY_PERMIT_ROWS[0]],
      }),
      'app-1',
      'user-1',
    );

    expect(forms[0].source).toBe('cache');
    expect(forms[0].downloadPath).toBe('/forms/app-1/file/IMM%201294');
    expect(forms[0].prefillable).toBe(true);
  });

  it("offers nothing rather than another route's forms when the registry has none", async () => {
    // The country fallback answers "every form this country uses, across all
    // its programs". Offering that as THIS application's forms is a wrong
    // answer, not a thin one: a Super visa application was handed IMM 1294
    // (study permit) and IMM 1295 (work permit) on production 2026-09-03.
    const svc = new FormsService(store());
    const forms = await svc.listForApplication(
      dbWith({ visaTypeId: 'visa-super-visa', registryRows: [] }),
      'app-1',
      'user-1',
    );

    expect(forms).toEqual([]);
  });

  it('still uses the country catalog when NO route has been chosen', async () => {
    // Nothing has been narrowed down yet, so the country-wide list is the best
    // honest answer — this is the discovery-mode path, unchanged.
    const svc = new FormsService(store());
    const forms = await svc.listForApplication(
      dbWith({ visaTypeId: null }),
      'app-1',
      'user-1',
    );

    expect(forms.length).toBeGreaterThan(0);
  });

  it('does not invent forms when the registry read fails', async () => {
    // A failed read is indistinguishable from "no rows" here, and the same
    // rule applies: a chosen route is never answered with another route's
    // forms. The applicant sees no section rather than the wrong one.
    const svc = new FormsService(store());
    const forms = await svc.listForApplication(
      dbWith({
        visaTypeId: 'visa-study',
        registryError: { message: 'db down' },
      }),
      'app-1',
      'user-1',
    );

    expect(forms).toEqual([]);
  });

  it('skips a registry row that names no form code', async () => {
    const svc = new FormsService(store());
    const forms = await svc.listForApplication(
      dbWith({
        visaTypeId: 'visa-study',
        registryRows: [
          {
            official_form_code: null,
            official_form_url: null,
            label: 'A form, somewhere',
            requirement_code: 'unnamed',
          },
          STUDY_PERMIT_ROWS[0],
        ],
      }),
      'app-1',
      'user-1',
    );

    expect(forms.map((f) => f.formCode)).toEqual(['IMM 1294']);
  });
});

describe('FormsService — a form the applicant\'s answers rule out is not listed', () => {
  const ROWS = [
    { ...STUDY_PERMIT_ROWS[0], rule: null },
    {
      ...STUDY_PERMIT_ROWS[1],
      rule: { fact: 'marital_status', op: 'in', value: ['common_law', 'de_facto', 'partnered'] },
    },
  ];
  const codes = async (profile?: Record<string, unknown>) =>
    (
      await new FormsService(store()).listForApplication(
        dbWith({ visaTypeId: 'visa-study', registryRows: ROWS, profile }),
        'app-1',
        'user-1',
      )
    ).map((f) => f.formCode);

  it('drops the common-law declaration for a married applicant (live E2E 2026-10-20)', async () => {
    expect(await codes({ marital_status: 'Married' })).toEqual(['IMM 1294']);
  });

  it('keeps it for a common-law applicant, and when the status is not answered yet', async () => {
    expect(await codes({ marital_status: 'Common-law' })).toEqual(['IMM 1294', 'IMM 5409']);
    expect(await codes({})).toEqual(['IMM 1294', 'IMM 5409']);
    expect(await codes(undefined)).toEqual(['IMM 1294', 'IMM 5409']);
  });
});
