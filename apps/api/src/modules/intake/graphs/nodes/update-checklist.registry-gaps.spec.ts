import { makeUpdateChecklistNode } from './update-checklist';
import type { IntakeState } from '../intake.state';
import type { ChatOpenAI } from '@langchain/openai';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Dry run 2026-10-14: a Canada TRV family visitor with a prior refusal got a
 * checklist of IMM 5257, passport copy and travel history — nothing else.
 *
 * Two gaps in this node made that possible:
 *   1. `requirementsJson.undetermined` (rules nobody has answered yet) was
 *      built and then ignored, so "may be required" items vanished.
 *   2. Any framework item at all returned early, so discovery's strengthening
 *      evidence (bank statements, ties to home) never ran for a thin list.
 */

type Row = Record<string, unknown>;

function makeDb(opts: { existing?: Row[] } = {}) {
  const inserted: Row[][] = [];
  const updated: Array<{ values: Row; id: unknown }> = [];
  const db = {
    from(table: string) {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () =>
          Promise.resolve({
            data:
              table === 'visa_types'
                ? { official_name: 'Visitor visa', official_code: 'TRV' }
                : null,
          }),
        insert: (rows: Row[]) => {
          inserted.push(rows);
          return {
            select: () =>
              Promise.resolve({
                data: rows.map((r, i) => ({
                  ...r,
                  id: `item-${inserted.length}-${i}`,
                })),
                error: null,
              }),
          };
        },
        update: (values: Row) => ({
          eq: (_col: string, id: unknown) => {
            updated.push({ values, id });
            return Promise.resolve({ error: null });
          },
        }),
        then(resolve: (v: unknown) => unknown) {
          return Promise.resolve({
            data: table === 'checklist_items' ? (opts.existing ?? []) : [],
          }).then(resolve);
        },
      };
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient, inserted, updated };
}

function llmReturning(result: Row) {
  const calls: unknown[] = [];
  const llm = {
    withStructuredOutput() {
      return {
        stream: () => Promise.reject(new Error('no stream in test')),
        invoke: (prompt: unknown) => {
          calls.push(prompt);
          return Promise.resolve(result);
        },
      };
    },
  } as unknown as ChatOpenAI;
  return { llm, calls };
}

// Records the call: supplemental discovery swallows model errors by design,
// so a throwing stub alone would not prove the model was never reached.
let forbiddenCalled = false;
const forbiddenLlm = {
  withStructuredOutput() {
    forbiddenCalled = true;
    throw new Error('discovery must not run');
  },
} as unknown as ChatOpenAI;
beforeEach(() => {
  forbiddenCalled = false;
});
afterEach(() => {
  expect(forbiddenCalled).toBe(false);
});

const BASE: IntakeState = {
  applicationId: 'app-1',
  visaTypeId: 'visa-trv',
  frameworkId: null,
  destinationCountry: 'CA',
  destinationState: null,
  requirementsJson: {},
  profileJson: { purpose_of_visit: 'family visit' },
  riskIndicators: [],
  checklistItems: [],
  suggestedVisaTypes: [],
  messages: [],
  isComplete: false,
  currentQuestion: null,
} as unknown as IntakeState;

const TRV_REQUIREMENTS = {
  source: 'visa_registry',
  visaai_id: 'ca-visitor-visa',
  base_forms: [{ form_code: 'IMM 5257', form_name: 'Application for TRV' }],
  base_documents: [
    { type: 'passport_copy', label: 'Passport copy' },
    { type: 'travel_history', label: 'Travel history' },
  ],
  branch_rules: [],
  undetermined: [
    {
      requirement_code: 'imm5645',
      label: 'Family Information form',
      dependsOn: ['has_dependants'],
      kind: 'form',
      official_form_code: 'IMM 5645',
      official_form_url: 'https://www.canada.ca/imm5645.pdf',
    },
    {
      requirement_code: 'minor_travel_authorization',
      label: 'Letter authorizing a minor to travel',
      dependsOn: ['is_minor', 'travelling_with_minor'],
      kind: 'evidence',
    },
    {
      // Not a checklist row: never upload "pay the fee".
      requirement_code: 'some_fee',
      label: 'Fee',
      dependsOn: ['age'],
      kind: 'fee',
    },
  ],
  excluded: [],
};

const DISCOVERY = {
  required_forms: [
    {
      form_code: 'IMM 5257',
      form_name: 'dup',
      source_url: '',
      owner: 'applicant',
    },
  ],
  required_documents: [
    {
      type: 'bank_statement_6mo',
      label: 'Bank statements (6 months)',
      reason: 'proves funds',
      owner: 'applicant',
      specs: {
        format: '',
        dimensions: '',
        file_requirements: '',
        validity: '',
        source: 'Your bank',
        notes: '',
      },
    },
    {
      type: 'passport_copy',
      label: 'Passport (duplicate)',
      reason: 'dup',
      owner: 'applicant',
      specs: {
        format: '',
        dimensions: '',
        file_requirements: '',
        validity: '',
        source: '',
        notes: '',
      },
    },
  ],
  strengthening_documents: [
    {
      type: 'property_deed',
      label: 'Property ownership documents',
      reason: 'home ties',
      owner: 'applicant',
      specs: {
        format: '',
        dimensions: '',
        file_requirements: '',
        validity: '',
        source: 'Land registry',
        notes: '',
      },
    },
  ],
};

describe('updateChecklist — undetermined registry requirements', () => {
  it('adds undetermined documents and forms as optional "may be required" items', async () => {
    const { db, inserted } = makeDb();
    const { llm } = llmReturning({
      required_forms: [],
      required_documents: [],
      strengthening_documents: [],
    });
    const node = makeUpdateChecklistNode(db, llm, null);

    await node({ ...BASE, requirementsJson: TRV_REQUIREMENTS });

    const rows = inserted[0];
    const maybe = rows.filter((r) => r.added_reason === 'base_conditional');
    expect(maybe.map((r) => r.document_type).sort()).toEqual([
      'form_imm_5645',
      'minor_travel_authorization',
    ]);
    for (const r of maybe) {
      expect(r.required).toBe(false);
      expect(r.label).toMatch(/may be required/i);
      expect((r.meta as Row).may_be_required).toBe(true);
    }
    const form = maybe.find((r) => r.document_type === 'form_imm_5645')!;
    expect(form.meta).toMatchObject({
      kind: 'form',
      form_code: 'IMM 5645',
      source_url: 'https://www.canada.ca/imm5645.pdf',
      depends_on: ['has_dependants'],
    });
    // Determined base items stay required.
    const passport = rows.find((r) => r.document_type === 'passport_copy')!;
    expect(passport.required).toBe(true);
  });

  it('never turns a condition/step/fee into a checklist row', async () => {
    const { db, inserted } = makeDb();
    const { llm } = llmReturning({
      required_forms: [],
      required_documents: [],
      strengthening_documents: [],
    });
    const node = makeUpdateChecklistNode(db, llm, null);

    await node({ ...BASE, requirementsJson: TRV_REQUIREMENTS });

    const all = inserted.flat().map((r) => r.document_type);
    expect(all).not.toContain('some_fee');
  });

  it('promotes a "may be required" item to required once its rule resolves true', async () => {
    const { db, updated, inserted } = makeDb({
      existing: [
        {
          id: 'row-minor',
          document_type: 'minor_travel_authorization',
          required: false,
          added_reason: 'base_conditional',
          meta: { kind: 'document', may_be_required: true },
        },
      ],
    });
    const node = makeUpdateChecklistNode(db, forbiddenLlm, null);

    await node({
      ...BASE,
      requirementsJson: {
        ...TRV_REQUIREMENTS,
        base_documents: [
          { type: 'a', label: 'A' },
          { type: 'b', label: 'B' },
          { type: 'c', label: 'C' },
          { type: 'd', label: 'D' },
          {
            type: 'minor_travel_authorization',
            label: 'Letter authorizing a minor to travel',
          },
        ],
        undetermined: [],
      },
    });

    expect(updated).toEqual([
      {
        id: 'row-minor',
        values: expect.objectContaining({
          required: true,
          added_reason: 'base_requirement',
          label: 'Letter authorizing a minor to travel',
        }),
      },
    ]);
    // Not re-inserted as a duplicate.
    expect(
      inserted
        .flat()
        .filter((r) => r.document_type === 'minor_travel_authorization'),
    ).toHaveLength(0);
  });
});

describe('updateChecklist — IMM 5476 when a representative is used (#50)', () => {
  const GUIDANCE =
    'Complete and sign IMM 5476, have your representative sign it.';

  it('a determined form carries its guidance onto the checklist item', async () => {
    const { db, inserted } = makeDb();
    const node = makeUpdateChecklistNode(db, forbiddenLlm, null);

    await node({
      ...BASE,
      requirementsJson: {
        ...TRV_REQUIREMENTS,
        base_forms: [
          { form_code: 'IMM 5257', form_name: 'Application for TRV' },
          {
            form_code: 'IMM 5476',
            form_name: 'Use of a Representative',
            specs: { note: GUIDANCE },
          },
        ],
        base_documents: [
          { type: 'a', label: 'A' },
          { type: 'b', label: 'B' },
          { type: 'c', label: 'C' },
          { type: 'd', label: 'D' },
        ],
        undetermined: [],
      },
    });

    const row = inserted
      .flat()
      .find((r) => r.document_type === 'form_imm_5476')!;
    expect(row.required).toBe(true);
    expect(row.meta).toMatchObject({
      kind: 'form',
      form_code: 'IMM 5476',
      specs: { note: GUIDANCE },
    });
  });

  it('promotes the "may be required" IMM 5476 once the applicant names a representative', async () => {
    const { db, updated } = makeDb({
      existing: [
        {
          id: 'row-5476',
          document_type: 'form_imm_5476',
          required: false,
          added_reason: 'base_conditional',
          meta: { kind: 'form', may_be_required: true },
        },
      ],
    });
    const node = makeUpdateChecklistNode(db, forbiddenLlm, null);

    await node({
      ...BASE,
      requirementsJson: {
        ...TRV_REQUIREMENTS,
        base_forms: [
          {
            form_code: 'IMM 5476',
            form_name: 'Use of a Representative',
            specs: { note: GUIDANCE },
          },
        ],
        base_documents: [
          { type: 'a', label: 'A' },
          { type: 'b', label: 'B' },
          { type: 'c', label: 'C' },
          { type: 'd', label: 'D' },
        ],
        undetermined: [],
      },
    });

    expect(updated).toEqual([
      {
        id: 'row-5476',
        values: expect.objectContaining({
          required: true,
          meta: expect.objectContaining({ specs: { note: GUIDANCE } }),
        }),
      },
    ]);
  });
});

describe('updateChecklist — supplemental discovery on a thin sourced list', () => {
  it('runs discovery additively when the registry yields ≤3 documents', async () => {
    const { db, inserted } = makeDb();
    const { llm, calls } = llmReturning(DISCOVERY);
    const node = makeUpdateChecklistNode(db, llm, null);

    const result = await node({ ...BASE, requirementsJson: TRV_REQUIREMENTS });

    expect(calls).toHaveLength(1);
    const discovered = inserted[1];
    const types = discovered.map((r) => r.document_type);
    // Additive only: nothing the registry already supplied, no duplicate form.
    expect(types).toEqual(['bank_statement_6mo', 'property_deed']);
    // Never presented as an official requirement on top of the sourced list.
    for (const r of discovered) {
      expect(r.required).toBe(false);
      expect((r.meta as Row).strength).toBe(true);
    }
    // Returned state includes both the sourced and the discovered items.
    const all = (result.checklistItems ?? []).map((i) => i.document_type);
    expect(all).toEqual(
      expect.arrayContaining([
        'passport_copy',
        'form_imm_5257',
        'bank_statement_6mo',
      ]),
    );
  });

  it('does not call the model when the registry already gives >3 documents', async () => {
    const { db } = makeDb();
    const node = makeUpdateChecklistNode(db, forbiddenLlm, null);

    await expect(
      node({
        ...BASE,
        requirementsJson: {
          ...TRV_REQUIREMENTS,
          undetermined: [],
          base_documents: [1, 2, 3, 4].map((n) => ({
            type: `doc_${n}`,
            label: `Doc ${n}`,
          })),
        },
      }),
    ).resolves.toBeDefined();
  });

  it('runs once: skips the model when strengthening items already exist', async () => {
    const { db } = makeDb({
      existing: [
        {
          id: 'x',
          document_type: 'passport_copy',
          required: true,
          added_reason: 'base_requirement',
          meta: { kind: 'document' },
        },
        {
          id: 'y',
          document_type: 'property_deed',
          required: false,
          added_reason: 'strengthening:ties',
          meta: { kind: 'document', strength: true },
        },
      ],
    });
    const node = makeUpdateChecklistNode(db, forbiddenLlm, null);

    await expect(
      node({
        ...BASE,
        checklistItems: [
          {
            id: 'x',
            document_type: 'passport_copy',
            label: 'P',
            required: true,
            status: 'missing',
            added_reason: 'base_requirement',
            meta: { kind: 'document' },
          },
          {
            id: 'y',
            document_type: 'property_deed',
            label: 'D',
            required: false,
            status: 'missing',
            added_reason: 'strengthening:ties',
            meta: { kind: 'document', strength: true },
          },
        ] as never,
        requirementsJson: { ...TRV_REQUIREMENTS, undetermined: [] },
      }),
    ).resolves.toBeDefined();
  });

  it('keeps the sourced items when supplemental discovery fails', async () => {
    const { db } = makeDb();
    const llm = {
      withStructuredOutput() {
        return {
          stream: () => Promise.reject(new Error('down')),
          invoke: () => Promise.reject(new Error('down')),
        };
      },
    } as unknown as ChatOpenAI;
    const node = makeUpdateChecklistNode(db, llm, null);

    const result = await node({ ...BASE, requirementsJson: TRV_REQUIREMENTS });

    expect((result.checklistItems ?? []).map((i) => i.document_type)).toEqual(
      expect.arrayContaining([
        'passport_copy',
        'travel_history',
        'form_imm_5257',
      ]),
    );
  });
});

describe('updateChecklist — optional (recommended) sourced documents', () => {
  it('inserts a base document flagged required:false as an optional item', async () => {
    const { db, inserted } = makeDb();
    const node = makeUpdateChecklistNode(db, forbiddenLlm, null);

    await node({
      ...BASE,
      requirementsJson: {
        ...TRV_REQUIREMENTS,
        undetermined: [],
        base_documents: [
          { type: 'a', label: 'A' },
          { type: 'b', label: 'B' },
          { type: 'c', label: 'C' },
          { type: 'd', label: 'D' },
          {
            type: 'travel_history',
            label: 'Evidence of previous travel',
            required: false,
          },
        ],
      },
    });

    const row = inserted
      .flat()
      .find((r) => r.document_type === 'travel_history')!;
    expect(row.required).toBe(false);
    expect(row.added_reason).toBe('base_requirement');
  });

  it('demotes an existing sourced row that was wrongly inserted as required', async () => {
    // Rows written before the fix (prod app 71ad0c29) carry required=true and
    // keep blocking the forms gate until something corrects them.
    const { db, updated } = makeDb({
      existing: [
        {
          id: 'row-travel',
          document_type: 'travel_history',
          required: true,
          added_reason: 'base_requirement',
          meta: { kind: 'document' },
        },
      ],
    });
    const node = makeUpdateChecklistNode(db, forbiddenLlm, null);

    await node({
      ...BASE,
      requirementsJson: {
        ...TRV_REQUIREMENTS,
        undetermined: [],
        base_documents: [
          { type: 'a', label: 'A' },
          { type: 'b', label: 'B' },
          { type: 'c', label: 'C' },
          { type: 'd', label: 'D' },
          {
            type: 'travel_history',
            label: 'Evidence of previous travel',
            required: false,
          },
        ],
      },
    });

    expect(updated).toEqual([
      { id: 'row-travel', values: { required: false } },
    ]);
  });

  it('does not demote a row the applicant or another source owns', async () => {
    const { db, updated } = makeDb({
      existing: [
        {
          id: 'row-travel',
          document_type: 'travel_history',
          required: true,
          added_reason: 'discovery:proves travel',
          meta: { kind: 'document' },
        },
      ],
    });
    const node = makeUpdateChecklistNode(db, forbiddenLlm, null);

    await node({
      ...BASE,
      requirementsJson: {
        ...TRV_REQUIREMENTS,
        undetermined: [],
        base_documents: [1, 2, 3, 4]
          .map((n) => ({ type: `d${n}`, label: `D${n}` }) as Row)
          .concat([
            { type: 'travel_history', label: 'Travel', required: false },
          ]),
      },
    });

    expect(updated).toEqual([]);
  });
});
