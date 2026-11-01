import { makeUpdateChecklistNode } from './update-checklist';
import type { IntakeState } from '../intake.state';
import type { ChatOpenAI } from '@langchain/openai';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Which requirements the checklist is built FROM.
 *
 * The node used to choose its branch on `state.frameworkId`. `loadFromRegistry`
 * fills `requirementsJson` from the sourced registry and never sets a
 * frameworkId — there is no legacy `country_frameworks` row to point at — so
 * every registry-backed application fell through to LLM discovery and its own
 * sourced requirements were never turned into checklist items.
 */
function makeDb(inserted: Row[][]) {
  type R = Record<string, unknown>;
  const db = {
    from() {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        insert: (rows: R[]) => {
          inserted.push(rows);
          return {
            select: () =>
              Promise.resolve({
                data: rows.map((r, i) => ({ ...r, id: `item-${i}` })),
                error: null,
              }),
          };
        },
      };
      return builder;
    },
  };
  return db as unknown as SupabaseClient;
}

type Row = Record<string, unknown>;

/**
 * An LLM that records whether discovery reached it. (Throwing is not enough:
 * supplemental discovery on a thin list swallows model errors by design.)
 */
let llmCalled = false;
const forbiddenLlm = {
  withStructuredOutput() {
    llmCalled = true;
    throw new Error('discovery must not run when requirements exist');
  },
} as unknown as ChatOpenAI;
beforeEach(() => {
  llmCalled = false;
});

const BASE: IntakeState = {
  applicationId: 'app-1',
  visaTypeId: 'visa-1',
  frameworkId: null,
  destinationCountry: 'CA',
  destinationState: null,
  requirementsJson: {},
  profileJson: { purpose: 'work' },
  riskIndicators: [],
  checklistItems: [],
  suggestedVisaTypes: [],
  messages: [],
  isComplete: false,
  currentQuestion: null,
} as unknown as IntakeState;

describe('updateChecklist — branches on requirements, not on frameworkId', () => {
  it('builds from registry requirements when no frameworkId is set', async () => {
    const inserted: Row[][] = [];
    const node = makeUpdateChecklistNode(makeDb(inserted), forbiddenLlm, null);

    const result = await node({
      ...BASE,
      requirementsJson: {
        source: 'registry',
        base_documents: [
          { type: 'passport', label: 'Passport', required: true },
          { type: 'proof_of_funds', label: 'Proof of funds', required: true },
          { type: 'photo', label: 'Photo', required: true },
          { type: 'itinerary', label: 'Itinerary', required: true },
        ],
        base_forms: [],
        branch_rules: [],
      },
    });

    // Four sourced documents is not "thin", so no supplemental model call.
    expect(llmCalled).toBe(false);
    expect(result.checklistItems).toHaveLength(4);
    expect(inserted[0].map((r) => r.document_type)).toEqual([
      'passport',
      'proof_of_funds',
      'photo',
      'itinerary',
    ]);
  });

  it('falls through to discovery when there are no requirements at all', async () => {
    const inserted: Row[][] = [];
    let discoveryRan = false;
    const llm = {
      withStructuredOutput() {
        discoveryRan = true;
        return {
          invoke: () =>
            Promise.resolve({
              required_forms: [],
              required_documents: [],
              strengthening_documents: [],
            }),
        };
      },
    } as unknown as ChatOpenAI;

    const node = makeUpdateChecklistNode(makeDb(inserted), llm, null);
    await node({ ...BASE, requirementsJson: {} });

    expect(discoveryRan).toBe(true);
  });
});
