import { makeUpdateChecklistNode } from './update-checklist';
import type { IntakeState } from '../intake.state';
import type { ChatOpenAI } from '@langchain/openai';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Prod app 61f16bb5 (super visa, 2026-10-16), replayed: the checklist built
 * before the registry fix, then rebuilt against the corrected registry.
 */

jest.mock('../../../documents/family-gaps/family-gaps.sync', () => ({
  syncFamilyGapsForApplication: jest.fn().mockResolvedValue(undefined),
}));

type Row = Record<string, unknown>;

function makeDb(opts: { existing: Row[]; documents?: Row[] }) {
  const inserted: Row[] = [];
  const updated: Array<{ id: unknown; values: Row }> = [];
  const deleted: unknown[] = [];
  const db = {
    from(table: string) {
      const rows =
        table === 'checklist_items'
          ? opts.existing
          : table === 'documents'
            ? (opts.documents ?? [])
            : [];
      const b: any = {
        select: () => b,
        eq: () => b,
        in: () => b,
        maybeSingle: () => Promise.resolve({ data: null }),
        insert: (newRows: Row[]) => {
          inserted.push(...newRows);
          return {
            select: () =>
              Promise.resolve({
                data: newRows.map((r, i) => ({ ...r, id: `new-${i}` })),
                error: null,
              }),
          };
        },
        update: (values: Row) => ({
          eq: (_c: string, id: unknown) => {
            updated.push({ id, values });
            const chain: any = {
              eq: () => chain,
              then: (r: any) => Promise.resolve({ error: null }).then(r),
            };
            return chain;
          },
        }),
        delete: () => ({
          in: (_c: string, ids: unknown[]) => {
            deleted.push(...ids);
            return Promise.resolve({ error: null });
          },
        }),
        then: (r: any) => Promise.resolve({ data: rows, error: null }).then(r),
      };
      return b;
    },
  };
  return { db: db as unknown as SupabaseClient, inserted, updated, deleted };
}

const noLlm = {
  withStructuredOutput() {
    throw new Error('discovery must not run');
  },
} as unknown as ChatOpenAI;

const OLD_ROWS: Row[] = [
  [
    'host_letter_of_invitation',
    'HOST: writes and signs a letter of invitation',
    true,
  ],
  [
    'proof_of_medical_exam',
    'Proof of a medical exam with an approved panel physician',
    true,
  ],
  [
    'letter_of_invitation_contents',
    "The invitation letter must state the family-size list, with each person's name and date of birth",
    true,
  ],
  [
    'income_proof_option_one',
    'Option 1: host meets the full amount in either of the two tax years before applying',
    true,
  ],
  [
    'income_proof_option_two',
    "Option 2: host reaches 75% of the amount and the applicant's own income covers the rest",
    false,
  ],
].map(([t, label, required]) => ({
  id: `old-${t}`,
  document_type: t,
  label,
  required,
  status: 'missing',
  added_reason: 'base_requirement',
  meta: { kind: 'document', owner: 'applicant' },
}));

const SUPER_VISA = {
  source: 'visa_registry',
  visaai_id: 'ca-super-visa',
  branch_rules: [],
  undetermined: [],
  excluded: [],
  base_forms: [
    { form_code: 'IMM 5257', form_name: 'Application for Visitor Visa' },
  ],
  base_documents: [
    { type: 'passport_copy', label: 'Your passport' },
    {
      type: 'host_letter_of_invitation',
      label: 'Letter of invitation from your host',
      owner: 'sponsor',
    },
    {
      type: 'medical_insurance',
      label: 'Proof of Canadian medical insurance',
      validity_months: 12,
    },
    {
      type: 'proof_of_medical_exam',
      label: 'Proof of your immigration medical exam',
      required: false,
    },
    {
      type: 'income_proof_option_one',
      label: "Host's proof of income",
      owner: 'sponsor',
    },
  ],
};

const STATE = {
  applicationId: 'app-sv',
  visaTypeId: 'visa-sv',
  frameworkId: null,
  destinationCountry: 'CA',
  destinationState: null,
  requirementsJson: SUPER_VISA,
  profileJson: {},
  riskIndicators: [],
  checklistItems: [],
  suggestedVisaTypes: [],
  messages: [],
  isComplete: false,
  currentQuestion: null,
} as unknown as IntakeState;

describe('updateChecklist — reconciling a built checklist with the corrected registry', () => {
  it('removes the content-rule slot and the Option 2 slot, and adds passport + insurance', async () => {
    const { db, inserted, deleted } = makeDb({ existing: OLD_ROWS });
    await makeUpdateChecklistNode(db, noLlm, null)(STATE);

    expect(deleted).toEqual(
      expect.arrayContaining([
        'old-letter_of_invitation_contents',
        'old-income_proof_option_two',
      ]),
    );
    expect(deleted).toHaveLength(2);
    expect(inserted.map((r) => r.document_type)).toEqual(
      expect.arrayContaining([
        'passport_copy',
        'medical_insurance',
        'form_imm_5257',
      ]),
    );
  });

  it('relabels the surviving rows, files host documents under the host, and stops the IME gating', async () => {
    const { db, updated } = makeDb({ existing: OLD_ROWS });
    await makeUpdateChecklistNode(db, noLlm, null)(STATE);

    const byId = new Map(updated.map((u) => [u.id, u.values]));
    expect(byId.get('old-host_letter_of_invitation')).toEqual({
      label: 'Letter of invitation from your host',
      meta: { kind: 'document', owner: 'sponsor' },
    });
    expect(byId.get('old-proof_of_medical_exam')).toEqual(
      expect.objectContaining({ required: false }),
    );
  });

  it('carries the minimum validity onto the new insurance slot', async () => {
    const { db, inserted } = makeDb({ existing: [] });
    await makeUpdateChecklistNode(db, noLlm, null)(STATE);
    const ins = inserted.find((r) => r.document_type === 'medical_insurance')!;
    expect(ins.meta).toEqual(
      expect.objectContaining({ kind: 'document', min_validity_months: 12 }),
    );
    const letter = inserted.find(
      (r) => r.document_type === 'host_letter_of_invitation',
    )!;
    expect((letter.meta as Row).owner).toBe('sponsor');
  });

  it('keeps a stale slot the applicant already uploaded into, as optional', async () => {
    const { db, deleted, updated } = makeDb({
      existing: OLD_ROWS,
      documents: [{ checklist_item_id: 'old-income_proof_option_two' }],
    });
    await makeUpdateChecklistNode(db, noLlm, null)(STATE);
    expect(deleted).not.toContain('old-income_proof_option_two');
    // Already optional: nothing to change.
    expect(
      updated.find((u) => u.id === 'old-income_proof_option_two'),
    ).toBeUndefined();
  });

  it('leaves a legacy (non-registry) framework alone', async () => {
    const { db, deleted } = makeDb({ existing: OLD_ROWS });
    await makeUpdateChecklistNode(
      db,
      noLlm,
      null,
    )({
      ...STATE,
      requirementsJson: { ...SUPER_VISA, source: undefined },
    } as IntakeState);
    expect(deleted).toEqual([]);
  });
});
