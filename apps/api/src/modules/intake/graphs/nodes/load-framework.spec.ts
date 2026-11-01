import { makeLoadFrameworkNode } from './load-framework';
import type { IntakeState } from '../intake.state';

/**
 * The three-source precedence that decides where an applicant's checklist comes
 * from: sourced registry, then the legacy table, then discovery mode.
 *
 * This node had no tests, and it is the one place where the entire visa
 * registry either reaches a person or does not. For months its registry branch
 * returned null on every request — not because the branch was wrong, but
 * because nothing ever wrote `applications.visa_type_id`, so `state.visaTypeId`
 * was always null. The bug was invisible from here: the node did exactly what
 * it was told, with a value nobody set.
 */

type Row = Record<string, unknown>;

/**
 * Supabase stub for the exact chains this node uses. Each table is a fixture;
 * `errorOn` forces a table to fail so the degradation path can be tested.
 */
function makeDb(fixtures: {
  checklistItems?: Row[];
  country?: Row | null;
  visaType?: Row | null;
  requirements?: Row[];
  framework?: Row | null;
  errorOn?: string;
}) {
  const queried: string[] = [];

  const db = {
    from(table: string) {
      queried.push(table);
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        maybeSingle() {
          if (fixtures.errorOn === table)
            return Promise.reject(new Error('db down'));
          if (table === 'visa_countries')
            return Promise.resolve({ data: fixtures.country ?? null });
          if (table === 'visa_types')
            return Promise.resolve({ data: fixtures.visaType ?? null });
          return Promise.resolve({ data: null });
        },
        single() {
          if (table === 'country_frameworks')
            return Promise.resolve({ data: fixtures.framework ?? null });
          return Promise.resolve({ data: null });
        },
        then(resolve: (v: unknown) => unknown) {
          if (fixtures.errorOn === table)
            return Promise.reject(new Error('db down'));
          if (table === 'checklist_items')
            return Promise.resolve({
              data: fixtures.checklistItems ?? [],
            }).then(resolve);
          if (table === 'visa_requirements')
            return Promise.resolve({ data: fixtures.requirements ?? [] }).then(
              resolve,
            );
          return Promise.resolve({ data: [] }).then(resolve);
        },
      };
      return builder;
    },
  };

  return { db: db as any, queried };
}

const state = (over: Partial<IntakeState> = {}): IntakeState =>
  ({
    applicationId: 'app-1',
    visaTypeId: null,
    frameworkId: null,
    destinationCountry: 'CA',
    profileJson: {},
    ...over,
  }) as IntakeState;

const REGISTRY_ROWS: Row[] = [
  {
    requirement_code: 'passport_copy',
    kind: 'evidence',
    officially_required: true,
    label: 'Digital copy of your valid passport',
    description: null,
    official_form_code: null,
    official_form_url: null,
    rule: null,
    display_order: 100,
  },
  {
    requirement_code: 'minor_travel_authorization',
    kind: 'evidence',
    officially_required: true,
    label: 'Letter authorizing a minor to travel',
    description: null,
    official_form_code: null,
    official_form_url: null,
    rule: { fact: 'is_minor', op: 'eq', value: true },
    display_order: 200,
  },
];

const REGISTRY_FIXTURE = {
  country: { id: 'country-ca' },
  visaType: { id: 'vt-1', visaai_id: 'ca-visitor-visa' },
  requirements: REGISTRY_ROWS,
};

describe('loadFramework', () => {
  it('builds requirements from the sourced registry when a route is chosen', async () => {
    const { db } = makeDb(REGISTRY_FIXTURE);
    const node = makeLoadFrameworkNode(db);

    const result = await node(state({ visaTypeId: 'vt-1' }));
    const req = result.requirementsJson as Record<string, unknown>;

    expect(req.source).toBe('visa_registry');
    expect(req.visaai_id).toBe('ca-visitor-visa');
    expect(req.base_documents).toEqual([
      { type: 'passport_copy', label: 'Digital copy of your valid passport' },
    ]);
  });

  it('falls through to discovery mode when NO route has been chosen', async () => {
    // Not a failure state. Merging every visa type's requirements into one
    // checklist would show someone documents for a route they are not taking.
    const { db } = makeDb(REGISTRY_FIXTURE);
    const node = makeLoadFrameworkNode(db);

    const result = await node(state({ visaTypeId: null }));

    expect(result.requirementsJson).toEqual({});
  });

  it('reports an unanswered conditional requirement instead of dropping it', async () => {
    // The failure the three-valued rule engine exists to prevent: a
    // complete-looking checklist that silently omits a needed document.
    const { db } = makeDb(REGISTRY_FIXTURE);
    const node = makeLoadFrameworkNode(db);

    const result = await node(state({ visaTypeId: 'vt-1' }));
    const req = result.requirementsJson as Record<string, unknown>;

    expect(req.undetermined).toEqual([
      {
        requirement_code: 'minor_travel_authorization',
        label: 'Letter authorizing a minor to travel',
        dependsOn: ['is_minor'],
        kind: 'evidence',
      },
    ]);
  });

  it('includes a conditional requirement once the facts settle it', async () => {
    const { db } = makeDb(REGISTRY_FIXTURE);
    const node = makeLoadFrameworkNode(db);

    const result = await node(
      state({ visaTypeId: 'vt-1', profileJson: { is_minor: true } }),
    );
    const req = result.requirementsJson as Record<string, unknown>;

    expect(req.base_documents).toHaveLength(2);
    expect(req.undetermined).toEqual([]);
  });

  it('evaluates rules against NORMALIZED profile facts, not raw intake keys', async () => {
    // Dry run 2026-10-14: intake wrote purpose_of_visit "family visit"; the
    // rule reads `purpose`. Raw keys left the invitation letter undetermined.
    const { db } = makeDb({
      ...REGISTRY_FIXTURE,
      requirements: [
        ...REGISTRY_ROWS,
        {
          requirement_code: 'invitation_letter',
          kind: 'evidence',
          officially_required: true,
          label: 'Letter of invitation',
          description: null,
          official_form_code: null,
          official_form_url: null,
          rule: {
            fact: 'purpose',
            op: 'in',
            value: ['family', 'visit_family', 'visit_friends'],
          },
          display_order: 300,
        },
      ],
    });
    const node = makeLoadFrameworkNode(db);

    const result = await node(
      state({
        visaTypeId: 'vt-1',
        profileJson: {
          purpose_of_visit: 'family visit',
          date_of_birth: '1961-03-02',
        },
      }),
    );
    const req = result.requirementsJson as Record<string, unknown>;
    const types = (req.base_documents as Array<{ type: string }>).map(
      (d) => d.type,
    );

    expect(types).toContain('invitation_letter');
    // date_of_birth -> age -> is_minor=false settles the minor letter too.
    expect(types).not.toContain('minor_travel_authorization');
    expect(req.excluded).toContain('minor_travel_authorization');
    expect(req.undetermined).toEqual([]);
  });

  it('prefers the registry over the legacy framework when both exist', async () => {
    // The registry is the only one of the two that can say where a requirement
    // came from, so it wins whenever it has an answer.
    const { db } = makeDb({
      ...REGISTRY_FIXTURE,
      framework: { id: 'fw-1', requirements_json: { legacy: true } },
    });
    const node = makeLoadFrameworkNode(db);

    const result = await node(
      state({ visaTypeId: 'vt-1', frameworkId: 'fw-1' }),
    );

    expect((result.requirementsJson as Record<string, unknown>).source).toBe(
      'visa_registry',
    );
  });

  it('falls back to the legacy framework when the registry has no coverage', async () => {
    // Dropping this fallback would replace a thin checklist with no checklist.
    const { db } = makeDb({
      country: { id: 'country-ca' },
      visaType: { id: 'vt-1', visaai_id: 'ca-visitor-visa' },
      requirements: [],
      framework: { id: 'fw-1', requirements_json: { legacy: true } },
    });
    const node = makeLoadFrameworkNode(db);

    const result = await node(
      state({ visaTypeId: 'vt-1', frameworkId: 'fw-1' }),
    );

    expect(result.requirementsJson).toEqual({ legacy: true });
  });

  it('degrades to the legacy path when the registry read throws', async () => {
    // A registry outage must not end the interview: the applicant is
    // mid-conversation, and a thinner checklist beats a stopped conversation.
    const { db } = makeDb({
      ...REGISTRY_FIXTURE,
      errorOn: 'visa_countries',
      framework: { id: 'fw-1', requirements_json: { legacy: true } },
    });
    const node = makeLoadFrameworkNode(db);

    const result = await node(
      state({ visaTypeId: 'vt-1', frameworkId: 'fw-1' }),
    );

    expect(result.requirementsJson).toEqual({ legacy: true });
  });

  it('always returns the existing checklist items alongside requirements', async () => {
    const { db } = makeDb({
      ...REGISTRY_FIXTURE,
      checklistItems: [{ id: 'ci-1', label: 'Passport' }],
    });
    const node = makeLoadFrameworkNode(db);

    const result = await node(state({ visaTypeId: 'vt-1' }));

    expect(result.checklistItems).toEqual([{ id: 'ci-1', label: 'Passport' }]);
  });
});
