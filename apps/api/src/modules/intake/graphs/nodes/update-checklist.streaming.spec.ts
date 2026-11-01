import {
  completedItemsOnly,
  makeUpdateChecklistNode,
} from './update-checklist';
import type { IntakeState } from '../intake.state';

/**
 * The discovery generation was measured at 9-21s, and for the 31 visa types
 * whose registry carries no document-kind rows (Express Entry among them) it is
 * the only thing that produces a checklist — so those applicants watched an
 * empty vault for the whole of it. It is streamed now, and these cover the two
 * things that has to get right: never show a half-written item, and never send
 * the same item twice.
 */

describe('completedItemsOnly', () => {
  it('withholds the element still being written', () => {
    const mid = {
      required_documents: [
        { type: 'passport', label: 'Passport' },
        { type: 'funds', label: 'Proof of fun' },
      ],
    };

    // "Proof of fun" is on its way to "Proof of funds". Showing it is worse
    // than showing nothing.
    expect(completedItemsOnly(mid, false).required_documents).toEqual([
      { type: 'passport', label: 'Passport' },
    ]);
  });

  it('withholds a lone element entirely — nothing proves it is finished', () => {
    const mid = { required_documents: [{ type: 'pass', label: 'Pass' }] };
    expect(completedItemsOnly(mid, false).required_documents).toEqual([]);
  });

  it('lets everything through once the stream closes', () => {
    const full = {
      required_documents: [
        { type: 'passport', label: 'Passport' },
        { type: 'funds', label: 'Proof of funds' },
      ],
    };
    expect(completedItemsOnly(full, true)).toBe(full);
  });
});

/** Supabase stub: no existing checklist items, inserts echoed back with ids. */
function makeDb() {
  return {
    from() {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () =>
          Promise.resolve({
            data: [],
            error: null,
          }),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        insert: (rows: Array<Record<string, unknown>>) => ({
          select: () =>
            Promise.resolve({
              data: rows.map((r, i) => ({ id: `row-${i}`, ...r })),
              error: null,
            }),
        }),
      };
      return chain;
    },
  } as never;
}

/** A ChatOpenAI stand-in whose structured output arrives in chunks. */
function makeStreamingLlm(chunks: unknown[]) {
  const invoke = jest.fn();
  return {
    invoke,
    withStructuredOutput: () => ({
      invoke,
      stream: () =>
        Promise.resolve(
          (async function* () {
            for (const c of chunks) yield await Promise.resolve(c);
          })(),
        ),
    }),
  } as never;
}

/** A schema-complete document, so the FINAL parse succeeds the way a real
 *  structured answer does. Partial chunks deliberately carry less. */
function doc(type: string, label: string) {
  return {
    type,
    label,
    reason: 'needed',
    owner: 'applicant' as const,
    specs: {
      format: '',
      dimensions: '',
      file_requirements: '',
      validity: '',
      source: '',
      notes: '',
    },
  };
}

const STATE: IntakeState = {
  applicationId: 'app-1',
  visaTypeId: 'visa-1',
  frameworkId: null,
  destinationCountry: 'CA',
  destinationState: null,
  requirementsJson: {},
  profileJson: { purpose_of_visit: 'work' },
  riskIndicators: [],
  checklistItems: [],
  suggestedVisaTypes: [],
  messages: [],
  isComplete: false,
  currentQuestion: null,
} as unknown as IntakeState;

describe('discovery streaming', () => {
  it('emits each item once, in order, as the model finishes writing it', async () => {
    // The structured stream yields the answer growing one element at a time.
    const chunks = [
      { required_documents: [doc('passport', 'Pass')] },
      {
        required_documents: [
          doc('passport', 'Passport'),
          doc('funds', 'Proof of fun'),
        ],
      },
      {
        required_documents: [
          doc('passport', 'Passport'),
          doc('funds', 'Proof of funds'),
          doc('photo', 'Photo'),
        ],
      },
    ];

    const seen: string[] = [];
    const node = makeUpdateChecklistNode(
      makeDb(),
      makeStreamingLlm(chunks),
      null,
      undefined,
      (items) => {
        for (const i of items) seen.push(i.document_type);
      },
    );

    await node(STATE);

    // passport is complete once funds begins; funds once photo begins. photo is
    // still the last element, so it is withheld until the stream closes — and
    // it reaches the applicant in the final list, not as a preview.
    expect(seen).toEqual(['passport', 'funds']);
  });

  it('does not re-send an item that was already sent', async () => {
    // Every chunk re-states the whole answer so far. Emitting on the raw
    // mapping would send passport again in each one.
    const chunks = [
      {
        required_documents: [doc('passport', 'Passport'), doc('a', 'A')],
      },
      {
        required_documents: [
          doc('passport', 'Passport'),
          doc('a', 'A'),
          doc('b', 'B'),
        ],
      },
    ];

    const seen: string[] = [];
    const node = makeUpdateChecklistNode(
      makeDb(),
      makeStreamingLlm(chunks),
      null,
      undefined,
      (items) => {
        for (const i of items) seen.push(i.document_type);
      },
    );

    await node(STATE);

    expect(seen).toEqual(['passport', 'a']);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('falls back to the blocking call when the stream yields nothing usable', async () => {
    const llm = {
      withStructuredOutput: () => ({
        // An empty stream: the model yielded nothing the parser could use.
        stream: () =>
          Promise.resolve({
            [Symbol.asyncIterator]() {
              return {
                next: () =>
                  Promise.resolve({ done: true as const, value: undefined }),
              };
            },
          }),
        invoke: jest.fn().mockResolvedValue({
          required_forms: [],
          required_documents: [doc('passport', 'Passport')],
          strengthening_documents: [],
        }),
      }),
    } as never;

    const onProgress = jest.fn();
    const node = makeUpdateChecklistNode(
      makeDb(),
      llm,
      null,
      undefined,
      onProgress,
    );

    const result = await node(STATE);

    // A streaming failure costs the early paint and nothing else: the applicant
    // still gets the list.
    expect(
      result.checklistItems?.some((i) => i.document_type === 'passport'),
    ).toBe(true);
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('finishes the generation even when the consumer has gone away', async () => {
    // A closed tab must not abort a checklist the application still needs.
    const chunks = [
      {
        required_documents: [doc('passport', 'Passport'), doc('a', 'A')],
      },
    ];
    const node = makeUpdateChecklistNode(
      makeDb(),
      makeStreamingLlm(chunks),
      null,
      undefined,
      () => {
        throw new Error('client disconnected');
      },
    );

    const result = await node(STATE);
    expect(
      result.checklistItems?.some((i) => i.document_type === 'passport'),
    ).toBe(true);
  });
});
