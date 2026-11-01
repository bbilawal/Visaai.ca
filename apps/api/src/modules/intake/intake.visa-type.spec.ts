import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntakeService } from './intake.service';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { CheckpointService } from '../shared/langgraph/checkpoint.service';
import { AssignmentEventBus } from '../event-bus/assignment-event-bus';
import { AiUsageMeter } from '../shared/ai/ai-usage.meter';

/**
 * Choosing a visa route, and the guards on it.
 *
 * `applications.visa_type_id` is the key the whole sourced registry hangs off.
 * Until these methods existed nothing ever wrote it, so `load-framework.ts`
 * returned null from its registry branch on every single request and 293
 * verified requirements reached the public pages but never an applicant.
 *
 * The tests that matter most here are the negative ones. A checklist assembled
 * from the registry LOOKS authoritative — it cites government pages — so a
 * route accepted for the wrong country produces confidently wrong documents.
 */

type Row = Record<string, unknown>;

/**
 * Fixture columns mirror the REAL `visa_types` schema — `official_name` and
 * `lifecycle_state`, not `name` and `active`.
 *
 * The first version of this file invented the latter pair, and so did the
 * service. A hand-written Supabase stub returns its fixture regardless of which
 * columns were requested, so the tests passed against a schema that does not
 * exist and the endpoint failed on the first real request with
 * `column visa_types.name does not exist`.
 *
 * The durable guard is the `satisfies` on VISA_TYPE_COLUMNS in the service,
 * which makes a wrong column a compile error. These fixtures are kept accurate
 * so the two do not drift apart again.
 */

/**
 * Supabase stub covering the exact chains these two methods use. Tables are
 * plain fixtures; `updates` records writes so a test can assert what reached
 * the database rather than only what was returned.
 */
function makeDb(fixtures: {
  application?: Row | null;
  visaTypes?: Row[];
  visaCountries?: Row[];
  requirements?: Row[];
  profile?: Row | null;
}) {
  const updates: Array<{ table: string; row: Row }> = [];
  const visaTypes = fixtures.visaTypes ?? [];

  const db = {
    from(table: string) {
      const builder: any = {
        _filters: {} as Record<string, unknown>,
        select() {
          return builder;
        },
        eq(col: string, val: unknown) {
          builder._filters[col] = val;
          return builder;
        },
        in() {
          return builder;
        },
        order() {
          return builder;
        },
        update(row: Row) {
          updates.push({ table, row });
          return {
            eq() {
              return { eq: () => Promise.resolve({ error: null }) };
            },
          };
        },
        maybeSingle() {
          if (table === 'visa_countries') {
            const hit = (fixtures.visaCountries ?? []).find(
              (c) => c.code === builder._filters.code,
            );
            return Promise.resolve({ data: hit ?? null, error: null });
          }
          if (table === 'visa_types') {
            const hit = visaTypes.find((t) => t.id === builder._filters.id);
            return Promise.resolve({ data: hit ?? null, error: null });
          }
          if (table === 'application_profiles') {
            return Promise.resolve({
              data:
                fixtures.profile === undefined || fixtures.profile === null
                  ? null
                  : { profile_json: fixtures.profile },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        single() {
          if (table === 'applications') {
            return Promise.resolve({
              data: fixtures.application ?? null,
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve: (v: unknown) => unknown) {
          // Terminal await on a filtered list query.
          if (table === 'visa_types') {
            const rows = visaTypes.filter(
              (t) =>
                t.country_id === builder._filters.country_id &&
                t.lifecycle_state === 'active',
            );
            return Promise.resolve({ data: rows, error: null }).then(resolve);
          }
          if (table === 'visa_requirements') {
            return Promise.resolve({
              data: fixtures.requirements ?? [],
              error: null,
            }).then(resolve);
          }
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      };
      return builder;
    },
  };

  return { db: db as any, updates };
}

function makeService(checkpoint: { delete: jest.Mock }) {
  const config = {
    get: jest.fn().mockReturnValue('test-openai-key'),
  } as unknown as ConfigService;
  return new IntakeService(
    {} as SupabaseService,
    checkpoint as unknown as CheckpointService,
    config,
    { emit: jest.fn() } as unknown as AssignmentEventBus,
    {} as AiUsageMeter,
  );
}

const CA_APP = {
  id: 'app-1',
  user_id: 'user-1',
  destination_country: 'CA',
  visa_type_id: null,
};

const CA_VISITOR = {
  id: '11111111-1111-4111-8111-111111111111',
  visaai_id: 'ca-visitor-visa',
  official_name: 'Visitor visa',
  official_code: 'TRV',
  category: 'visitor',
  data_quality: 'verified',
  lifecycle_state: 'active',
  country_id: 'country-ca',
  visa_countries: { code: 'CA' },
};

const GB_STUDENT = {
  id: '22222222-2222-4222-8222-222222222222',
  visaai_id: 'gb-student-visa',
  official_name: 'Student visa',
  official_code: null,
  category: 'student',
  data_quality: 'verified',
  lifecycle_state: 'active',
  country_id: 'country-gb',
  visa_countries: { code: 'GB' },
};

describe('IntakeService.setVisaType', () => {
  it('records the chosen route on the application', async () => {
    const checkpoint = { delete: jest.fn().mockResolvedValue(undefined) };
    const service = makeService(checkpoint);
    const { db, updates } = makeDb({
      application: CA_APP,
      visaTypes: [CA_VISITOR],
    });

    const result = await service.setVisaType(
      db,
      'app-1',
      'user-1',
      CA_VISITOR.id,
    );

    expect(result).toMatchObject({ visaTypeId: CA_VISITOR.id, changed: true });
    expect(updates).toEqual([
      { table: 'applications', row: { visa_type_id: CA_VISITOR.id } },
    ]);
  });

  it('REJECTS a visa type belonging to another country', async () => {
    // The defect this exists to prevent. A UK student visa on a Canadian
    // application would build a checklist of UK documents that cites gov.uk —
    // wrong, and wrong in the most credible-looking way possible.
    const checkpoint = { delete: jest.fn() };
    const service = makeService(checkpoint);
    const { db, updates } = makeDb({
      application: CA_APP,
      visaTypes: [CA_VISITOR, GB_STUDENT],
    });

    await expect(
      service.setVisaType(db, 'app-1', 'user-1', GB_STUDENT.id),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(updates).toHaveLength(0);
    expect(checkpoint.delete).not.toHaveBeenCalled();
  });

  it('rejects an unknown visa type', async () => {
    const service = makeService({ delete: jest.fn() });
    const { db, updates } = makeDb({ application: CA_APP, visaTypes: [] });

    await expect(
      service.setVisaType(
        db,
        'app-1',
        'user-1',
        '33333333-3333-4333-8333-333333333333',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updates).toHaveLength(0);
  });

  it('rejects a retired visa type', async () => {
    const service = makeService({ delete: jest.fn() });
    const { db, updates } = makeDb({
      application: CA_APP,
      visaTypes: [{ ...CA_VISITOR, lifecycle_state: 'retired' }],
    });

    await expect(
      service.setVisaType(db, 'app-1', 'user-1', CA_VISITOR.id),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updates).toHaveLength(0);
  });

  it('denies access to an application the caller cannot see', async () => {
    const service = makeService({ delete: jest.fn() });
    const { db, updates } = makeDb({ application: null });

    await expect(
      service.setVisaType(db, 'app-1', 'user-1', CA_VISITOR.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(updates).toHaveLength(0);
  });

  it('clears the saved checkpoint when the route changes', async () => {
    // The checkpoint holds requirementsJson built for the PREVIOUS visa. Left
    // in place, the graph resumes with the old visa's documents and never
    // re-reads the registry.
    const checkpoint = { delete: jest.fn().mockResolvedValue(undefined) };
    const service = makeService(checkpoint);
    const { db } = makeDb({
      application: { ...CA_APP, visa_type_id: 'some-other-id' },
      visaTypes: [CA_VISITOR],
    });

    await service.setVisaType(db, 'app-1', 'user-1', CA_VISITOR.id);

    expect(checkpoint.delete).toHaveBeenCalledWith('app-1');
  });

  it('does not clear the checkpoint when the route is unchanged', async () => {
    // Re-selecting the same route is a no-op, not a reason to throw away work.
    const checkpoint = { delete: jest.fn() };
    const service = makeService(checkpoint);
    const { db, updates } = makeDb({
      application: { ...CA_APP, visa_type_id: CA_VISITOR.id },
      visaTypes: [CA_VISITOR],
    });

    const result = await service.setVisaType(
      db,
      'app-1',
      'user-1',
      CA_VISITOR.id,
    );

    expect(result).toMatchObject({ visaTypeId: CA_VISITOR.id, changed: false });
    expect(updates).toHaveLength(0);
    expect(checkpoint.delete).not.toHaveBeenCalled();
  });

  it('accepts null to return the application to discovery mode', async () => {
    const checkpoint = { delete: jest.fn().mockResolvedValue(undefined) };
    const service = makeService(checkpoint);
    const { db, updates } = makeDb({
      application: { ...CA_APP, visa_type_id: CA_VISITOR.id },
      visaTypes: [CA_VISITOR],
    });

    const result = await service.setVisaType(db, 'app-1', 'user-1', null);

    expect(result).toMatchObject({ visaTypeId: null, changed: true });
    expect(updates).toEqual([
      { table: 'applications', row: { visa_type_id: null } },
    ]);
  });
});

const CA_ETA = {
  id: '44444444-4444-4444-8444-444444444444',
  visaai_id: 'ca-electronic-travel-authorization-eta',
  official_name: 'Electronic travel authorization (eTA)',
  official_code: 'eTA',
  category: 'visitor',
  data_quality: 'verified',
  lifecycle_state: 'active',
  country_id: 'country-ca',
  visa_countries: { code: 'CA' },
};

describe('IntakeService.setVisaType — route eligibility (eTA)', () => {
  // Dry run 2026-10-16, app a37a534b: the interview had already told a
  // Pakistani applicant they need a visitor visa, and the selector still let
  // them pick the eTA — with no warning, straight to a checklist of eTA items.
  it('REFUSES the eTA for a visa-required national and names the visitor visa', async () => {
    const checkpoint = { delete: jest.fn() };
    const service = makeService(checkpoint);
    const { db, updates } = makeDb({
      application: CA_APP,
      visaTypes: [CA_ETA],
      profile: { nationality: 'Pakistan' },
    });

    const err = await service
      .setVisaType(db, 'app-1', 'user-1', CA_ETA.id)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    const body = (err as BadRequestException).getResponse() as Record<
      string,
      unknown
    >;
    expect(body.code).toBe('ROUTE_INELIGIBLE');
    expect(String(body.message)).toMatch(/visitor visa/i);
    expect(body.recommendedVisaaiId).toBe(
      'ca-visitor-visa-temporary-resident-visa',
    );
    expect(updates).toHaveLength(0);
    expect(checkpoint.delete).not.toHaveBeenCalled();
  });

  it('REFUSES the eTA for someone who does not need one (US citizen)', async () => {
    const service = makeService({ delete: jest.fn() });
    const { db, updates } = makeDb({
      application: CA_APP,
      visaTypes: [CA_ETA],
      profile: { citizenship: 'United States' },
    });

    await expect(
      service.setVisaType(db, 'app-1', 'user-1', CA_ETA.id),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updates).toHaveLength(0);
  });

  it('accepts the eTA for a visa-exempt national', async () => {
    const service = makeService({
      delete: jest.fn().mockResolvedValue(undefined),
    });
    const { db, updates } = makeDb({
      application: CA_APP,
      visaTypes: [CA_ETA],
      profile: { nationality: 'GB' },
    });

    const result = await service.setVisaType(db, 'app-1', 'user-1', CA_ETA.id);
    expect(result).toMatchObject({ visaTypeId: CA_ETA.id, changed: true });
    expect(updates).toHaveLength(1);
  });

  it('accepts the eTA before nationality is known — the interview asks it', async () => {
    const service = makeService({
      delete: jest.fn().mockResolvedValue(undefined),
    });
    const { db, updates } = makeDb({
      application: CA_APP,
      visaTypes: [CA_ETA],
      profile: null,
    });

    await service.setVisaType(db, 'app-1', 'user-1', CA_ETA.id);
    expect(updates).toHaveLength(1);
  });

  it('says whether the route still has questions, so the page can stay in the interview', async () => {
    const service = makeService({
      delete: jest.fn().mockResolvedValue(undefined),
    });
    const { db } = makeDb({
      application: CA_APP,
      visaTypes: [CA_ETA],
      profile: { nationality: 'GB' },
    });

    const result = await service.setVisaType(db, 'app-1', 'user-1', CA_ETA.id);
    expect(result).toMatchObject({ intakeComplete: false });
  });

  it('warns, when accepting the eTA with nationality unknown, that the passport decides', async () => {
    // Prod 2026-10-16, app 5d3a17a4: accepted silently, and the applicant
    // learned nothing until a Pakistani passport turned up later.
    const service = makeService({
      delete: jest.fn().mockResolvedValue(undefined),
    });
    const { db } = makeDb({
      application: CA_APP,
      visaTypes: [CA_ETA],
      profile: { purpose_of_visit: 'tourism' },
    });

    const result = await service.setVisaType(db, 'app-1', 'user-1', CA_ETA.id);
    expect(result).toMatchObject({
      changed: true,
      eligibility: { status: 'unknown' },
    });
    expect(
      (result as { eligibility: { reason: string } }).eligibility.reason,
    ).toMatch(/nationality/i);
  });

  it('carries no eligibility for a route no program judges', async () => {
    const service = makeService({
      delete: jest.fn().mockResolvedValue(undefined),
    });
    const { db } = makeDb({
      application: CA_APP,
      visaTypes: [CA_VISITOR],
      profile: {},
    });
    const result = await service.setVisaType(
      db,
      'app-1',
      'user-1',
      CA_VISITOR.id,
    );
    expect(result).not.toHaveProperty('eligibility');
  });

  it('does not run eTA rules on a route no program claims', async () => {
    const service = makeService({
      delete: jest.fn().mockResolvedValue(undefined),
    });
    const { db, updates } = makeDb({
      application: CA_APP,
      visaTypes: [CA_VISITOR],
      profile: { nationality: 'Pakistan' },
    });

    await service.setVisaType(db, 'app-1', 'user-1', CA_VISITOR.id);
    expect(updates).toHaveLength(1);
  });
});

describe('IntakeService.listVisaTypesForApplication', () => {
  it('lists the country’s routes with their sourced requirement counts', async () => {
    const service = makeService({ delete: jest.fn() });
    const { db } = makeDb({
      application: CA_APP,
      visaCountries: [{ id: 'country-ca', code: 'CA' }],
      visaTypes: [CA_VISITOR],
      requirements: [
        { visa_type_id: CA_VISITOR.id },
        { visa_type_id: CA_VISITOR.id },
      ],
    });

    const list = await service.listVisaTypesForApplication(
      db,
      'app-1',
      'user-1',
    );

    expect(list).toEqual([
      {
        id: CA_VISITOR.id,
        visaaiId: 'ca-visitor-visa',
        name: 'Visitor visa',
        officialCode: 'TRV',
        category: 'visitor',
        dataQuality: 'verified',
        requirementCount: 2,
      },
    ]);
  });

  it('still offers a route that has NO sourced requirements', async () => {
    // Filtering these out was the tempting version and it is wrong. Australia's
    // visas are real whether or not a WAF lets our monitor read them; hiding
    // them would tell the applicant VisaAI does not handle their case, when the
    // truth is only that we lack the requirements. requirementCount: 0 lets the
    // surface say so honestly.
    const service = makeService({ delete: jest.fn() });
    const { db } = makeDb({
      application: CA_APP,
      visaCountries: [{ id: 'country-ca', code: 'CA' }],
      visaTypes: [CA_VISITOR],
      requirements: [],
    });

    const list = await service.listVisaTypesForApplication(
      db,
      'app-1',
      'user-1',
    );

    expect(list).toHaveLength(1);
    expect(list[0].requirementCount).toBe(0);
  });

  it('tells the page, per route, whether THIS applicant may use it', async () => {
    // The selector re-reads this after each answer, so a route that the
    // profile has since ruled out (a Pakistani on the eTA) is flagged where the
    // applicant changes it — without deleting their choice.
    const service = makeService({ delete: jest.fn() });
    const { db } = makeDb({
      application: { ...CA_APP, visa_type_id: CA_ETA.id },
      visaCountries: [{ id: 'country-ca', code: 'CA' }],
      visaTypes: [CA_VISITOR, CA_ETA],
      profile: { nationality: 'Pakistan' },
    });

    const list = await service.listVisaTypesForApplication(
      db,
      'app-1',
      'user-1',
    );
    const eta = list.find((o) => o.id === CA_ETA.id)!;
    expect(eta.eligibility).toMatchObject({
      status: 'ineligible',
      recommendedVisaaiId: 'ca-visitor-visa-temporary-resident-visa',
    });
    expect(eta.eligibility?.reason).toMatch(/visitor visa/i);
    expect(list.find((o) => o.id === CA_VISITOR.id)).not.toHaveProperty(
      'eligibility',
    );
  });

  it('returns nothing when the application has no destination country yet', async () => {
    const service = makeService({ delete: jest.fn() });
    const { db } = makeDb({
      application: { ...CA_APP, destination_country: null },
    });

    await expect(
      service.listVisaTypesForApplication(db, 'app-1', 'user-1'),
    ).resolves.toEqual([]);
  });

  it('denies access to an application the caller cannot see', async () => {
    const service = makeService({ delete: jest.fn() });
    const { db } = makeDb({ application: null });

    await expect(
      service.listVisaTypesForApplication(db, 'app-1', 'user-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
