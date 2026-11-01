import { ConfigService } from '@nestjs/config';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { IntakeService } from './intake.service';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { CheckpointService } from '../shared/langgraph/checkpoint.service';
import { AssignmentEventBus } from '../event-bus/assignment-event-bus';
import { AiUsageMeter } from '../shared/ai/ai-usage.meter';
import * as graphModule from './graphs/intake.graph';

const OPENING = 'What is the purpose of your visit to Canada?';

/**
 * `applications` / `application_profiles` / `checklist_items` reads, plus the
 * `intake_messages` transcript, with every insert recorded.
 */
function makeDb(transcript: Array<{ role: string; content: string }>) {
  const inserted: Array<Record<string, unknown>> = [];
  const db = {
    from(table: string) {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        order: () =>
          Promise.resolve(
            table === 'intake_messages'
              ? { data: transcript, error: null }
              : { data: [], error: null },
          ),
        single: () =>
          Promise.resolve(
            table === 'applications'
              ? {
                  data: {
                    id: 'app-1',
                    visa_type_id: 'visa-1',
                    framework_id: null,
                    destination_country: 'CA',
                    destination_state: null,
                  },
                  error: null,
                }
              : { data: null, error: null },
          ),
        insert: (row: Record<string, unknown>) => {
          inserted.push({ table, ...row });
          return Promise.resolve({ error: null });
        },
        then: undefined,
      };
      return chain;
    },
  };
  return { db: db as any, inserted };
}

function makeService(checkpoint: Partial<CheckpointService>) {
  return new IntakeService(
    {} as SupabaseService,
    checkpoint as CheckpointService,
    { get: jest.fn().mockReturnValue('test-key') } as unknown as ConfigService,
    { emit: jest.fn() } as unknown as AssignmentEventBus,
    {} as AiUsageMeter,
  );
}

describe('IntakeService.startOrResume — no checkpoint is not a fresh intake', () => {
  afterEach(() => jest.restoreAllMocks());

  it('restores the stored transcript and does not re-write the opening line', async () => {
    // `setVisaType` deletes the checkpoint on purpose. Before this, the next
    // start read `messages: []`, re-ran the interview from the top, and
    // appended a SECOND identical opening line — seen in production on
    // 2026-09-03 as the same question printed twice, with the applicant's
    // earlier answers invisible to the model.
    const checkpoint = {
      load: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue(undefined),
      acquireStartLock: jest.fn().mockResolvedValue(true),
      releaseStartLock: jest.fn().mockResolvedValue(undefined),
    };
    const service = makeService(checkpoint);
    const { db, inserted } = makeDb([
      { role: 'assistant', content: OPENING },
      { role: 'user', content: 'tourism' },
      { role: 'assistant', content: OPENING },
    ]);

    const invoke = jest.fn((state: any) =>
      Promise.resolve({ ...state, currentQuestion: OPENING }),
    );
    jest
      .spyOn(graphModule, 'buildIntakeGraph')
      .mockReturnValue({ invoke } as any);

    const resumed = await service.startOrResume(db, 'app-1', 'user-1');

    // The interview resumes with what was already said.
    expect(resumed.messages).toHaveLength(3);
    expect(resumed.messages[0]).toBeInstanceOf(AIMessage);
    expect(resumed.messages[1]).toBeInstanceOf(HumanMessage);

    // ...and the line already at the end of the transcript is not written again.
    expect(
      inserted.filter((row) => row.table === 'intake_messages'),
    ).toHaveLength(0);

    // INTAKE-004: the pending question is resumed VERBATIM and the model is
    // never asked to produce it again. Regenerating it returned a paraphrase,
    // which the exact-match dedupe could not recognise, so the applicant was
    // shown the same question two and three times over.
    expect(resumed.currentQuestion).toBe(OPENING);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('never appends a PARAPHRASE of the question already on screen (INTAKE-004)', async () => {
    // The production failure, exactly. The guard this replaces compared the
    // regenerated question to the last transcript line with `===`, and the
    // model does not reword its way back to the same string — so the check
    // passed and the paraphrase was written. Observed live on 2026-09-06 as
    // three consecutive assistant turns asking the same thing, differing only
    // in their examples, after the visa type was changed twice.
    const checkpoint = {
      load: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue(undefined),
      acquireStartLock: jest.fn().mockResolvedValue(true),
      releaseStartLock: jest.fn().mockResolvedValue(undefined),
    };
    const service = makeService(checkpoint);
    const { db, inserted } = makeDb([{ role: 'assistant', content: OPENING }]);

    // A graph that answers with a REWORDING, not the original.
    const invoke = jest.fn((state: any) =>
      Promise.resolve({
        ...state,
        currentQuestion:
          'What is the purpose of your visit to Canada? (For example: tourism, work, study, family, business, or permanent immigration.)',
      }),
    );
    jest
      .spyOn(graphModule, 'buildIntakeGraph')
      .mockReturnValue({ invoke } as any);

    const resumed = await service.startOrResume(db, 'app-1', 'user-1');

    expect(invoke).not.toHaveBeenCalled();
    expect(resumed.currentQuestion).toBe(OPENING);
    expect(
      inserted.filter((row) => row.table === 'intake_messages'),
    ).toHaveLength(0);
  });

  it('still regenerates when the applicant has answered the pending question', async () => {
    // The resume path must not swallow a turn that is genuinely owed a new
    // question: a transcript ending in the APPLICANT's answer needs the model.
    const checkpoint = {
      load: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue(undefined),
      acquireStartLock: jest.fn().mockResolvedValue(true),
      releaseStartLock: jest.fn().mockResolvedValue(undefined),
    };
    const service = makeService(checkpoint);
    const { db } = makeDb([
      { role: 'assistant', content: OPENING },
      { role: 'user', content: 'tourism' },
    ]);

    const invoke = jest.fn((state: any) =>
      Promise.resolve({ ...state, currentQuestion: 'How long will you stay?' }),
    );
    jest
      .spyOn(graphModule, 'buildIntakeGraph')
      .mockReturnValue({ invoke } as any);

    const result = await service.startOrResume(db, 'app-1', 'user-1');

    expect(invoke).toHaveBeenCalled();
    expect(result.currentQuestion).toBe('How long will you stay?');
  });

  it('writes the opening line when the transcript is empty', async () => {
    const checkpoint = {
      load: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue(undefined),
      acquireStartLock: jest.fn().mockResolvedValue(true),
      releaseStartLock: jest.fn().mockResolvedValue(undefined),
    };
    const service = makeService(checkpoint);
    const { db, inserted } = makeDb([]);

    jest.spyOn(graphModule, 'buildIntakeGraph').mockReturnValue({
      invoke: (state: any) =>
        Promise.resolve({ ...state, currentQuestion: OPENING }),
    } as any);

    await service.startOrResume(db, 'app-1', 'user-1');

    expect(inserted).toContainEqual(
      expect.objectContaining({
        table: 'intake_messages',
        role: 'assistant',
        content: OPENING,
      }),
    );
  });
});
