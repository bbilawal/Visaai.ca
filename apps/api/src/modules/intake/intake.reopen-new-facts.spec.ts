import { ConfigService } from '@nestjs/config';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { isIntakeAnswered } from '@visaai/types';
import { IntakeService, MESSAGE_IN_PROGRESS } from './intake.service';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { CheckpointService } from '../shared/langgraph/checkpoint.service';
import { AssignmentEventBus } from '../event-bus/assignment-event-bus';
import { AiUsageMeter } from '../shared/ai/ai-usage.meter';
import * as graphModule from './graphs/intake.graph';
import type { IntakeState } from './graphs/intake.state';
import { IRCC_PORTAL_ANSWERS } from '../../../test/fixtures/ircc-portal-answers';

/**
 * Prod 2026-10-29 (app 945eb7f1, Canada TRV): PR #295 made `spouse_name` a
 * required intake fact. The stage nav (isIntakeAnswered on the profile row)
 * reopened the Intake stage, but the intake page resumed the finished
 * checkpoint as-is — `isComplete: true`, closing line as the current question —
 * so it said "Intake complete" and never asked the new question.
 *
 * A resume of a finished session now decides exactly as the nav does (profile
 * row + the application's destination and registry visa type) and, when the
 * answers no longer are complete, asks the next missing question — under the
 * message lock, so it cannot interleave with an applicant's turn.
 */

const TRV = 'ca-visitor-visa-temporary-resident-visa';
const CLOSING = 'Thanks — your intake is complete.';
const NEXT = "What is your spouse's full name?";

const ANSWERED: Record<string, unknown> = {
  purpose_of_visit: 'family visit',
  employed: false,
  planned_entry_date: '2027-03-01',
  planned_departure_date: '2027-05-01',
  passport_type: 'Regular',
  us_permanent_resident: false,
  has_valid_us_visa: false,
  previously_visited_canada: false,
  uses_representative: false,
  ...IRCC_PORTAL_ANSWERS,
};
const BEFORE_PR_295 = { ...ANSWERED };
delete BEFORE_PR_295.spouse_name;

function finished(
  profileJson: Record<string, unknown>,
  requirementsJson: Record<string, unknown> = { visaai_id: TRV },
): IntakeState {
  return {
    applicationId: 'app-1',
    visaTypeId: 'visa-1',
    frameworkId: null,
    destinationCountry: 'CA',
    destinationState: null,
    requirementsJson,
    profileJson,
    riskIndicators: [],
    checklistItems: [],
    suggestedVisaTypes: [],
    messages: [
      new AIMessage('What is your marital status?'),
      new HumanMessage('Married'),
      new AIMessage(CLOSING),
    ],
    isComplete: true,
    currentQuestion: CLOSING,
  } as unknown as IntakeState;
}

/** `row` is the application_profiles row — what the stage nav reads. */
function makeDb(row: Record<string, unknown>) {
  const inserted: Array<Record<string, unknown>> = [];
  const application = {
    id: 'app-1',
    visa_type_id: 'visa-1',
    framework_id: null,
    destination_country: 'CA',
    destination_state: null,
    visa_types: { visaai_id: TRV },
  };
  const db = {
    from(table: string) {
      const result =
        table === 'applications'
          ? { data: application, error: null }
          : table === 'application_profiles'
            ? { data: { profile_json: row }, error: null }
            : { data: null, error: null };
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        order: () => Promise.resolve({ data: [], error: null }),
        single: () => Promise.resolve(result),
        maybeSingle: () => Promise.resolve(result),
        insert: (r: Record<string, unknown>) => {
          inserted.push({ table, ...r });
          return Promise.resolve({ error: null });
        },
      };
      return chain;
    },
  };
  return { db: db as any, inserted };
}

/** An in-memory checkpoint store with real (NX) locks. */
function makeCheckpoint(initial: IntakeState) {
  let state: IntakeState | null = initial;
  const locks = new Map<string, string>();
  return {
    get state() {
      return state;
    },
    load: jest.fn(() => Promise.resolve(state)),
    save: jest.fn((_id: string, s: IntakeState) => {
      state = s;
      return Promise.resolve();
    }),
    acquireStartLock: jest.fn(() => {
      if (locks.has('start')) return Promise.resolve(false);
      locks.set('start', '1');
      return Promise.resolve(true);
    }),
    releaseStartLock: jest.fn(() => {
      locks.delete('start');
      return Promise.resolve();
    }),
    acquireMessageLock: jest.fn((_id: string, token: string) => {
      if (locks.has('message')) return Promise.resolve(false);
      locks.set('message', token);
      return Promise.resolve(true);
    }),
    releaseMessageLock: jest.fn((_id: string, token: string) => {
      if (locks.get('message') === token) locks.delete('message');
      return Promise.resolve();
    }),
  };
}

function makeService(checkpoint: ReturnType<typeof makeCheckpoint>) {
  return new IntakeService(
    {} as SupabaseService,
    checkpoint as unknown as CheckpointService,
    { get: jest.fn().mockReturnValue('test-key') } as unknown as ConfigService,
    { emit: jest.fn() } as unknown as AssignmentEventBus,
    {} as AiUsageMeter,
  );
}

/** A graph whose first run is the reopen (asks NEXT), later runs echo. */
function graphAskingNext(gate?: Promise<void>) {
  let runs = 0;
  const invoke = jest.fn(async (state: IntakeState): Promise<IntakeState> => {
    runs += 1;
    if (runs === 1) await gate;
    const q: string = runs === 1 ? NEXT : 'Thanks, noted. Anything else?';
    return {
      ...state,
      currentQuestion: q,
      messages: [...state.messages, new AIMessage(q)],
    };
  });
  jest
    .spyOn(graphModule, 'buildIntakeGraph')
    .mockReturnValue({ invoke } as any);
  return invoke;
}

const assistantLines = (inserted: Array<Record<string, unknown>>) =>
  inserted
    .filter((r) => r.table === 'intake_messages' && r.role === 'assistant')
    .map((r) => r.content);

describe('IntakeService.startOrResume — a finished intake with new required facts', () => {
  afterEach(() => jest.restoreAllMocks());

  it('fixtures: answered before #295, not after', () => {
    const route = { country: 'CA', visaaiId: TRV };
    expect(isIntakeAnswered(ANSWERED, route)).toBe(true);
    expect(isIntakeAnswered(BEFORE_PR_295, route)).toBe(false);
  });

  it('reopens the interview and asks the next missing question, under the message lock', async () => {
    const checkpoint = makeCheckpoint(finished(BEFORE_PR_295));
    const service = makeService(checkpoint);
    const { db, inserted } = makeDb(BEFORE_PR_295);
    const invoke = graphAskingNext();

    const resumed = await service.startOrResume(db, 'app-1', 'user-1');

    expect(invoke).toHaveBeenCalledTimes(1);
    const input = invoke.mock.calls[0][0];
    expect(input.isComplete).toBe(false);
    expect(input.messages).toHaveLength(3);
    expect(input.profileJson).toMatchObject({ marital_status: 'Married' });

    expect(resumed.isComplete).toBe(false);
    expect(resumed.currentQuestion).toBe(NEXT);
    expect(checkpoint.state).toBe(resumed);
    expect(assistantLines(inserted)).toEqual([NEXT]);
    expect(checkpoint.acquireMessageLock).toHaveBeenCalledTimes(1);
    expect(checkpoint.releaseMessageLock).toHaveBeenCalledTimes(1);
  });

  it('a spouse name on the profile row keeps it complete (checkpoint lacks it)', async () => {
    const checkpoint = makeCheckpoint(finished(BEFORE_PR_295));
    const service = makeService(checkpoint);
    const { db } = makeDb(ANSWERED);
    const invoke = graphAskingNext();

    const resumed = await service.startOrResume(db, 'app-1', 'user-1');
    expect(invoke).not.toHaveBeenCalled();
    expect(resumed.isComplete).toBe(true);
    expect(resumed.currentQuestion).toBe(CLOSING);
  });

  it('a still-complete intake resumes untouched, no model call', async () => {
    const saved = finished(ANSWERED);
    const checkpoint = makeCheckpoint(saved);
    const service = makeService(checkpoint);
    const { db } = makeDb(ANSWERED);
    const invoke = graphAskingNext();

    expect(await service.startOrResume(db, 'app-1', 'user-1')).toBe(saved);
    expect(invoke).not.toHaveBeenCalled();
    expect(checkpoint.save).not.toHaveBeenCalled();
  });

  it('decides like the nav: a fact only in the checkpoint does not hide a missing row fact', async () => {
    const checkpoint = makeCheckpoint(finished(ANSWERED));
    const service = makeService(checkpoint);
    const { db } = makeDb(BEFORE_PR_295);
    const invoke = graphAskingNext();

    const resumed = await service.startOrResume(db, 'app-1', 'user-1');
    expect(invoke).toHaveBeenCalledTimes(1);
    // The row is what the nav reads, so it is what the interview resumes from.
    expect(invoke.mock.calls[0][0].profileJson.spouse_name).toBeUndefined();
    expect(resumed.currentQuestion).toBe(NEXT);
  });

  it("decides like the nav: uses the application's visa type when the checkpoint has none", async () => {
    // Without a visaai_id the checkpoint route falls back to the generic
    // facts, which BEFORE_PR_295 answers; the application's TRV route does not.
    expect(
      isIntakeAnswered(BEFORE_PR_295, { country: 'CA', visaaiId: null }),
    ).toBe(true);
    const checkpoint = makeCheckpoint(finished(BEFORE_PR_295, {}));
    const service = makeService(checkpoint);
    const { db } = makeDb(BEFORE_PR_295);
    const invoke = graphAskingNext();

    const resumed = await service.startOrResume(db, 'app-1', 'user-1');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(resumed.currentQuestion).toBe(NEXT);
  });

  it('a message sent during the reopen is not lost and gets one question asked', async () => {
    const checkpoint = makeCheckpoint(finished(BEFORE_PR_295));
    const service = makeService(checkpoint);
    const { db, inserted } = makeDb(BEFORE_PR_295);
    let open!: () => void;
    const invoke = graphAskingNext(new Promise<void>((r) => (open = r)));

    const reopening = service.startOrResume(db, 'app-1', 'user-1');
    await new Promise((r) => setImmediate(r));
    expect(invoke).toHaveBeenCalledTimes(1); // reopen is mid model call

    // The turn cannot run against the old completed checkpoint: it is refused
    // as retryable before the message is stored, and nothing is overwritten.
    await expect(
      service.sendMessage(db, 'app-1', 'user-1', 'Hina Farooq'),
    ).rejects.toThrow(MESSAGE_IN_PROGRESS);
    expect(inserted.filter((r) => r.role === 'user')).toHaveLength(0);

    open();
    await reopening;
    expect(assistantLines(inserted)).toEqual([NEXT]);

    // The retry runs on the reopened state and keeps the applicant's answer.
    await service.sendMessage(db, 'app-1', 'user-1', 'Hina Farooq');
    const turn = invoke.mock.calls[1][0];
    expect(turn.isComplete).toBe(false);
    expect(turn.messages.map((m: any) => m.content)).toEqual([
      'What is your marital status?',
      'Married',
      CLOSING,
      NEXT,
      'Hina Farooq',
    ]);
    expect(checkpoint.state!.messages.at(-2)!.content).toBe('Hina Farooq');
  });

  it('a second tab waits for the reopened state instead of showing "complete"', async () => {
    const checkpoint = makeCheckpoint(finished(BEFORE_PR_295));
    const service = makeService(checkpoint);
    const { db } = makeDb(BEFORE_PR_295);
    let open!: () => void;
    const invoke = graphAskingNext(new Promise<void>((r) => (open = r)));

    const tabA = service.startOrResume(db, 'app-1', 'user-1');
    await new Promise((r) => setImmediate(r));
    const tabB = service.startOrResume(db, 'app-1', 'user-1');
    await new Promise((r) => setImmediate(r));
    open();

    const [a, b] = await Promise.all([tabA, tabB]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(a.currentQuestion).toBe(NEXT);
    expect(b.isComplete).toBe(false);
    expect(b.currentQuestion).toBe(NEXT);
  });
});
