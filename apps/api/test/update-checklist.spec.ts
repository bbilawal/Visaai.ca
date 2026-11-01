import { makeUpdateChecklistNode } from '../src/modules/intake/graphs/nodes/update-checklist';
import type { IntakeState } from '../src/modules/intake/graphs/intake.state';

function freshState(over: Partial<IntakeState> = {}): IntakeState {
  return {
    applicationId: 'app-1',
    frameworkId: null,
    visaTypeId: null, // discovery (LLM) path
    destinationCountry: 'FI',
    destinationState: null,
    requirementsJson: {},
    profileJson: { purpose: 'tourism' }, // non-empty so discovery runs
    riskIndicators: [],
    checklistItems: [],
    suggestedVisaTypes: [],
    messages: [],
    isComplete: false,
    currentQuestion: null,
    checklistBuiltAt: null,
    profileChanges: [],
    ...over,
  };
}

/** Supabase stub: select.eq -> current items (empty); insert.select -> echo rows. */
function makeDb() {
  const inserted: Array<Record<string, unknown>> = [];
  const db = {
    from() {
      return {
        select() {
          return {
            eq() {
              return Promise.resolve({ data: [], error: null });
            },
          };
        },
        insert(rows: Array<Record<string, unknown>>) {
          inserted.push(...rows);
          return {
            select() {
              return Promise.resolve({
                data: rows.map((r, i) => ({ id: `c${i}`, ...r })),
                error: null,
              });
            },
          };
        },
      };
    },
  };

  return { db: db as any, inserted };
}

/** LLM stub: captures the prompt messages, returns a canned discovery result. */
function makeLlm(result: unknown) {
  const captured: {
    messages: Array<{ role: string; content: string }> | null;
  } = { messages: null };
  const llm = {
    withStructuredOutput() {
      return {
        invoke(messages: Array<{ role: string; content: string }>) {
          captured.messages = messages;
          return Promise.resolve(result);
        },
      };
    },
  };

  return { llm: llm as any, captured };
}

describe('updateChecklist discovery — country context + leakage guard', () => {
  const cannedResult = {
    required_forms: [
      {
        // FOREIGN: Canadian form leaking into a Finland flow — must be stripped.
        form_code: 'IMM 5257',
        form_name: 'Application for Temporary Resident Visa',
        source_url: 'https://www.canada.ca/imm5257',
        owner: 'applicant',
      },
      {
        // Correct: Schengen uniform application — must be kept.
        form_code: 'Application for Schengen Visa',
        form_name: 'Schengen Uniform Visa Application',
        source_url: 'https://example.europa.eu/schengen',
        owner: 'applicant',
      },
    ],
    required_documents: [],
    strengthening_documents: [],
  };

  it('sends the country NAME (not the bare code) to the model', async () => {
    const { db } = makeDb();
    const { llm, captured } = makeLlm(cannedResult);
    const node = makeUpdateChecklistNode(db, llm);

    await node(freshState({ destinationCountry: 'FI' }));

    const userMsg =
      captured.messages?.find((m) => m.role === 'user')?.content ?? '';
    expect(userMsg).toContain('Finland');
    // and an explicit country lock instruction
    expect(userMsg.toLowerCase()).toMatch(/only .*finland|finland .*only/);
  });

  it('strips a foreign (Canadian IMM) form from a Finland flow but keeps the Schengen form', async () => {
    const { db, inserted } = makeDb();
    const { llm } = makeLlm(cannedResult);
    const node = makeUpdateChecklistNode(db, llm);

    await node(freshState({ destinationCountry: 'FI' }));

    const formCodes = inserted
      .map((r) => (r.meta as { form_code?: string } | undefined)?.form_code)
      .filter(Boolean);
    expect(formCodes).not.toContain('IMM 5257'); // leakage blocked
    expect(formCodes).toContain('Application for Schengen Visa'); // correct one kept
  });
});
