import { makeUpdateChecklistNode } from './update-checklist';
import type { IntakeState } from '../intake.state';
import type { ChatOpenAI } from '@langchain/openai';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * A brand-new application has no interview answers, and 31 of the 177 visa
 * types carrying requirements have no document-kind rows at all — every
 * Japanese status of residence, five French routes, Canada's Express Entry. For
 * those, the registry yields nothing to upload and discovery is the only source
 * of a checklist.
 *
 * Discovery used to refuse to run on an empty profile, so the applicant was
 * shown an empty vault with no explanation. Observed on production 2026-09-04:
 * an Express Entry application whose rebuild returned `[]` in 18ms, far too
 * fast to have called a model at all.
 *
 * The route is the fix and also the limit: a named route plus a country is real
 * signal. A country alone is a guess, and discovery still declines that.
 */

type Row = Record<string, unknown>;

function makeDb(inserted: Row[][], visaTypeRow: Row | null) {
  const db = {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () =>
          Promise.resolve({
            data: table === 'visa_types' ? visaTypeRow : null,
            error: null,
          }),
        insert: (rows: Row[]) => {
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

/** Captures the prompt so the route line can be asserted, and returns one item. */
function makeLlm(capture: { userMessage?: string }) {
  return {
    withStructuredOutput() {
      return {
        invoke: (messages: Array<{ role: string; content: string }>) => {
          capture.userMessage = messages.find(
            (m) => m.role === 'user',
          )?.content;
          return Promise.resolve({
            required_forms: [],
            required_documents: [
              {
                type: 'proof_of_funds',
                label: 'Proof of settlement funds',
                reason: 'Express Entry requires proof of funds',
                owner: 'applicant',
                // Schema-complete on purpose: what production caches is the
                // model's own structured output, so a fixture that skips
                // required fields would test a round-trip that never happens.
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
            strengthening_documents: [],
          });
        },
      };
    },
  } as unknown as ChatOpenAI;
}

const BASE: IntakeState = {
  applicationId: 'app-1',
  visaTypeId: 'visa-express-entry',
  frameworkId: null,
  destinationCountry: 'CA',
  destinationState: null,
  // The case that matters: nothing answered yet.
  requirementsJson: {},
  profileJson: {},
  riskIndicators: [],
  checklistItems: [],
  suggestedVisaTypes: [],
  messages: [],
  isComplete: false,
  currentQuestion: null,
  checklistBuiltAt: null,
};

describe('updateChecklist — empty profile', () => {
  it('still builds a checklist when the applicant has named a route', async () => {
    const inserted: Row[][] = [];
    const capture: { userMessage?: string } = {};
    const node = makeUpdateChecklistNode(
      makeDb(inserted, {
        official_name: 'Express Entry',
        official_code: null,
      }),
      makeLlm(capture),
      null,
    );

    await node(BASE);

    expect(inserted.flat().length).toBeGreaterThan(0);
  });

  it('names the chosen route in the prompt, not just the country', async () => {
    // Without this, an Express Entry applicant and a visitor-visa applicant to
    // the same country get the same prompt and the same documents.
    const inserted: Row[][] = [];
    const capture: { userMessage?: string } = {};
    const node = makeUpdateChecklistNode(
      makeDb(inserted, {
        official_name: 'Express Entry',
        official_code: null,
      }),
      makeLlm(capture),
      null,
    );

    await node(BASE);

    expect(capture.userMessage).toContain('Express Entry');
    expect(capture.userMessage).toContain('Canada');
  });

  it('still declines when there is neither a profile nor a route', async () => {
    // A country on its own is a guess, and that guard is the reason the
    // original check existed. It stays.
    const inserted: Row[][] = [];
    const capture: { userMessage?: string } = {};
    const node = makeUpdateChecklistNode(
      makeDb(inserted, null),
      makeLlm(capture),
      null,
    );

    await node({ ...BASE, visaTypeId: null });

    expect(inserted).toHaveLength(0);
    expect(capture.userMessage).toBeUndefined();
  });
});

describe('updateChecklist — discovery cache', () => {
  function makeCache(seed?: Record<string, string>) {
    const store = new Map<string, string>(Object.entries(seed ?? {}));
    return {
      store,
      gets: [] as string[],
      sets: [] as string[],
      get(parts: { input: string }) {
        this.gets.push(parts.input);
        return Promise.resolve(store.get(parts.input) ?? null);
      },
      set(parts: { input: string }, value: string) {
        this.sets.push(parts.input);
        store.set(parts.input, value);
        return Promise.resolve();
      },
    };
  }

  it('serves a cached list without calling the model', async () => {
    const inserted: Row[][] = [];
    const capture: { userMessage?: string } = {};
    const cache = makeCache();
    // Prime by running once, then run again and assert the model was not used.
    const db1 = makeDb(inserted, {
      official_name: 'Express Entry',
      official_code: null,
    });
    await makeUpdateChecklistNode(db1, makeLlm(capture), null, cache)(BASE);
    expect(cache.sets).toHaveLength(1);

    const second: { userMessage?: string } = {};
    const db2 = makeDb([], {
      official_name: 'Express Entry',
      official_code: null,
    });
    await makeUpdateChecklistNode(db2, makeLlm(second), null, cache)(BASE);

    expect(second.userMessage).toBeUndefined();
  });

  it("keys on the prompt, so a different profile cannot collect another applicant's list", async () => {
    // This is the property that replaced "never cache once they have answered".
    // Caching every path is what makes repeat visits fast; what keeps it safe is
    // that the key is the prompt, and the prompt carries the answers — so two
    // applicants in different situations can never share an entry.
    const cache = makeCache();
    const db = makeDb([], {
      official_name: 'Express Entry',
      official_code: null,
    });

    await makeUpdateChecklistNode(
      db,
      makeLlm({}),
      null,
      cache,
    )({
      ...BASE,
      profileJson: { purpose: 'work' },
    });
    await makeUpdateChecklistNode(
      makeDb([], { official_name: 'Express Entry', official_code: null }),
      makeLlm({}),
      null,
      cache,
    )({ ...BASE, profileJson: { purpose: 'study' } });

    expect(cache.sets).toHaveLength(2);
    expect(cache.sets[0]).not.toEqual(cache.sets[1]);
  });

  it('reuses the entry when the applicant returns to the same state', async () => {
    // The reported symptom: moving between the interview and the documents page
    // paid a full model call every time.
    const cache = makeCache();
    const state = { ...BASE, profileJson: { purpose: 'work' } };

    await makeUpdateChecklistNode(
      makeDb([], { official_name: 'Express Entry', official_code: null }),
      makeLlm({}),
      null,
      cache,
    )(state);

    const second: { userMessage?: string } = {};
    await makeUpdateChecklistNode(
      makeDb([], { official_name: 'Express Entry', official_code: null }),
      makeLlm(second),
      null,
      cache,
    )(state);

    expect(second.userMessage).toBeUndefined();
  });

  it('falls through to the model when the cached value no longer fits the schema', async () => {
    const capture: { userMessage?: string } = {};
    const cache = makeCache();
    const db = makeDb([], {
      official_name: 'Express Entry',
      official_code: null,
    });
    // Seed a value shaped like an older schema.
    const node = makeUpdateChecklistNode(db, makeLlm(capture), null, cache);
    cache.store.set(
      // The key is the prompt itself; run once to learn it.
      await (async () => {
        await node(BASE);
        return cache.sets[0];
      })(),
      '{"required_forms":[],"supporting_documents":[]}',
    );

    const again: { userMessage?: string } = {};
    await makeUpdateChecklistNode(
      makeDb([], { official_name: 'Express Entry', official_code: null }),
      makeLlm(again),
      null,
      cache,
    )(BASE);

    expect(again.userMessage).toBeDefined();
  });

  it('still works with no cache at all', async () => {
    const inserted: Row[][] = [];
    const capture: { userMessage?: string } = {};
    const node = makeUpdateChecklistNode(
      makeDb(inserted, { official_name: 'Express Entry', official_code: null }),
      makeLlm(capture),
      null,
    );

    await node(BASE);

    expect(inserted.flat().length).toBeGreaterThan(0);
  });
});
