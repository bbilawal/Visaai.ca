import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * The receipt (`onAccepted`) means "your message is stored", and nothing less.
 *
 * It used to be emitted the moment a message arrived. The turn could still
 * fail before the write — the message lock (a dropped connection leaves the
 * previous turn holding it for up to 180s), the access check, the session
 * open — and the browser, already told the message was safe, let the next
 * history replay drop it. Prod 2026-10-21 / 2026-10-24: messages vanished.
 *
 * The client's id is the row id, so a resend of a stored message is
 * recognised: re-acknowledged if it was answered, and ANSWERED — the turn run
 * once more, without storing it again — if its turn had failed.
 */

const invoke = jest.fn();
jest.mock('./graphs/intake.graph', () => ({
  buildIntakeGraph: () => ({ invoke }),
}));

import {
  DuplicateIntakeMessageError,
  IntakeService,
  MESSAGE_IN_PROGRESS,
  withoutRefusedTurns,
} from './intake.service';
import { SAFE_FALLBACK } from '../shared/guardrails/guardrails.service';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { CheckpointService } from '../shared/langgraph/checkpoint.service';
import { AssignmentEventBus } from '../event-bus/assignment-event-bus';
import { AiUsageMeter } from '../shared/ai/ai-usage.meter';

const ID = '7f1c2a9e-3b4d-4c5e-8f60-123456789abc';

type Events = string[];

function makeDb(
  events: Events,
  opts: {
    stored?: 'answered' | 'unanswered';
    insertError?: { code?: string; message: string } | null;
    /** A later applicant message exists; replies before it answer the stored one. */
    nextUserAt?: string;
    /** Replies, by created_at, after the stored message. */
    replyAt?: string[];
  } = {},
) {
  const inserts: Array<Record<string, unknown>> = [];
  const db: any = {
    inserts,
    from: (table: string) => {
      let role: string | undefined;
      let before: string | undefined;
      let ordered = false;
      const chain: any = {
        select: () => chain,
        eq: (col: string, v: string) => {
          if (col === 'role') role = v;
          return chain;
        },
        gt: () => chain,
        lt: (_c: string, v: string) => {
          before = v;
          return chain;
        },
        limit: () => {
          if (role === 'user')
            return Promise.resolve({
              data: opts.nextUserAt ? [{ created_at: opts.nextUserAt }] : [],
              error: null,
            });
          const replies =
            opts.replyAt ??
            (opts.stored === 'answered' ? ['2026-10-24T10:00:05Z'] : []);
          const hit = replies.filter((at) => !before || at < before);
          return Promise.resolve({
            data: hit.map((at) => ({ id: `reply-${at}` })),
            error: null,
          });
        },
        order: () => {
          ordered = true;
          return chain;
        },
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null, ordered }).then(res),
        single: () =>
          Promise.resolve(
            table === 'applications'
              ? { data: { id: 'app-1' }, error: null }
              : { data: null, error: null },
          ),
        maybeSingle: () =>
          Promise.resolve({
            data:
              table === 'intake_messages' && opts.stored
                ? {
                    id: ID,
                    content: 'stored text',
                    created_at: '2026-10-24T10:00:00Z',
                  }
                : null,
            error: null,
          }),
        insert: (row: Record<string, unknown>) => {
          events.push(`insert:${String(row.role)}`);
          inserts.push(row);
          return Promise.resolve({ error: opts.insertError ?? null });
        },
      };
      return chain;
    },
  };
  return db;
}

function makeService(events: Events, checkpoint: Partial<CheckpointService>) {
  return new IntakeService(
    {} as SupabaseService,
    {
      acquireMessageLock: jest.fn(() => {
        events.push('lock');
        return Promise.resolve(true);
      }),
      releaseMessageLock: jest.fn().mockResolvedValue(undefined),
      save: jest.fn().mockResolvedValue(undefined),
      load: jest.fn().mockResolvedValue({
        currentQuestion: 'Are you married?',
        messages: [],
        profileJson: {},
      }),
      ...checkpoint,
    } as unknown as CheckpointService,
    { get: jest.fn() } as unknown as ConfigService,
    { emit: jest.fn() } as unknown as AssignmentEventBus,
    {} as AiUsageMeter,
  );
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({ currentQuestion: 'Next?', isComplete: false });
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('IntakeService.sendMessage — receipt only after the message is stored', () => {
  it('stores the message under the client id, THEN accepts it, then runs the turn', async () => {
    const events: Events = [];
    const db = makeDb(events);
    const svc = makeService(events, {});

    await svc.sendMessage(db, 'app-1', 'user-1', 'yes', undefined, {
      clientMsgId: ID,
      onAccepted: () => events.push('accepted'),
    });

    expect(events.slice(0, 3)).toEqual(['lock', 'insert:user', 'accepted']);
    expect(db.inserts[0]).toMatchObject({
      id: ID,
      role: 'user',
      content: 'yes',
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('a held message lock fails the turn WITHOUT accepting the message', async () => {
    const events: Events = [];
    const svc = makeService(events, {
      acquireMessageLock: jest.fn().mockResolvedValue(false),
    });
    const onAccepted = jest.fn();

    const err = await svc
      .sendMessage(makeDb(events), 'app-1', 'user-1', 'yes', undefined, {
        clientMsgId: ID,
        onAccepted,
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect((err as Error).message).toBe(MESSAGE_IN_PROGRESS);
    expect(onAccepted).not.toHaveBeenCalled();
    expect(events).not.toContain('insert:user');
  });

  it('a failed write fails the turn and is never acknowledged', async () => {
    const events: Events = [];
    const onAccepted = jest.fn();
    const svc = makeService(events, {});

    await expect(
      svc.sendMessage(
        makeDb(events, { insertError: { message: 'connection reset' } }),
        'app-1',
        'user-1',
        'yes',
        undefined,
        { clientMsgId: ID, onAccepted },
      ),
    ).rejects.toThrow(/Could not save the message/);
    expect(onAccepted).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('N1: stored, turn failed, resent → the turn runs once more, the message is NOT stored again', async () => {
    const events: Events = [];
    const svc = makeService(events, {});
    const onAccepted = jest.fn(() => events.push('accepted'));

    // First attempt: stored, then the model times out.
    invoke.mockRejectedValueOnce(new Error('Request timed out'));
    const firstDb = makeDb(events);
    await expect(
      svc.sendMessage(
        firstDb,
        'app-1',
        'user-1',
        'my date is 2019-04-02',
        undefined,
        {
          clientMsgId: ID,
          onAccepted,
        },
      ),
    ).rejects.toThrow(/timed out/);
    expect(invoke).toHaveBeenCalledTimes(1);

    // Retry with the same id: the row exists and nothing answered it.
    events.length = 0;
    const retryDb = makeDb(events, { stored: 'unanswered' });
    await svc.sendMessage(
      retryDb,
      'app-1',
      'user-1',
      'my date is 2019-04-02',
      undefined,
      {
        clientMsgId: ID,
        onAccepted,
      },
    );

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(events.slice(0, 2)).toEqual(['lock', 'accepted']);
    expect(events).not.toContain('insert:user');
    // The turn answers the STORED text.
    const state = invoke.mock.calls[1][0] as {
      messages: Array<{ content: unknown }>;
    };
    expect(state.messages.at(-1)?.content).toBe('stored text');
  });

  it('N1: stored AND answered, resent → recognised, no lock, no write, no turn', async () => {
    const events: Events = [];
    const svc = makeService(events, {});
    const onAccepted = jest.fn();

    await expect(
      svc.sendMessage(
        makeDb(events, { stored: 'answered' }),
        'app-1',
        'user-1',
        'yes',
        undefined,
        { clientMsgId: ID, onAccepted },
      ),
    ).rejects.toBeInstanceOf(DuplicateIntakeMessageError);
    expect(events).toEqual([]);
    expect(onAccepted).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('A failed, B typed and answered, Retry A → A runs (a later reply is not its answer)', async () => {
    const events: Events = [];
    const db = makeDb(events, {
      stored: 'unanswered',
      nextUserAt: '2026-10-24T10:01:00Z',
      replyAt: ['2026-10-24T10:01:05Z'],
    });
    const stored = await (makeService(events, {}) as any).findStored(
      db,
      'app-1',
      ID,
    );
    expect(stored).toEqual(
      expect.objectContaining({ id: ID, answered: false }),
    );
  });

  it('a reply before the next applicant message answers it', async () => {
    const events: Events = [];
    const db = makeDb(events, {
      stored: 'unanswered',
      nextUserAt: '2026-10-24T10:01:00Z',
      replyAt: ['2026-10-24T10:00:05Z', '2026-10-24T10:01:05Z'],
    });
    const stored = await (makeService(events, {}) as any).findStored(
      db,
      'app-1',
      ID,
    );
    expect(stored).toEqual(expect.objectContaining({ answered: true }));
  });

  it('N1: stored, unanswered, its turn still running → in progress, not a silent re-ack', async () => {
    const events: Events = [];
    const svc = makeService(events, {
      acquireMessageLock: jest.fn().mockResolvedValue(false),
    });
    const onAccepted = jest.fn();

    await expect(
      svc.sendMessage(
        makeDb(events, { stored: 'unanswered' }),
        'app-1',
        'user-1',
        'yes',
        undefined,
        { clientMsgId: ID, onAccepted },
      ),
    ).rejects.toThrow(MESSAGE_IN_PROGRESS);
    expect(onAccepted).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('two identical answers with different ids are two messages', async () => {
    const events: Events = [];
    const svc = makeService(events, {});
    const db = makeDb(events);
    const other = '7f1c2a9e-3b4d-4c5e-8f60-123456789abd';

    for (const id of [ID, other]) {
      await svc.sendMessage(db, 'app-1', 'user-1', 'yes', undefined, {
        clientMsgId: id,
      });
    }

    const users = db.inserts.filter(
      (r: Record<string, unknown>) => r.role === 'user',
    );
    expect(users.map((r: Record<string, unknown>) => r.id)).toEqual([
      ID,
      other,
    ]);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('a primary-key race on the same id reads as a duplicate', async () => {
    const events: Events = [];
    const svc = makeService(events, {});
    let reads = 0;
    const db = makeDb(events, {
      insertError: { code: '23505', message: 'duplicate key' },
    });
    const from = db.from;
    db.from = (table: string) => {
      const chain = from(table);
      chain.maybeSingle = () =>
        Promise.resolve({
          // Absent at the pre-check, present once the insert collides.
          data:
            table === 'intake_messages' && reads++ > 0
              ? { id: ID, content: 'yes', created_at: '2026-10-24T10:00:00Z' }
              : null,
          error: null,
        });
      return chain;
    };

    await expect(
      svc.sendMessage(db, 'app-1', 'user-1', 'yes', undefined, {
        clientMsgId: ID,
      }),
    ).rejects.toBeInstanceOf(DuplicateIntakeMessageError);
  });
});

describe('IntakeService.recordRefusedMessage', () => {
  it('stores the message and the refusal, accepting after the message is stored', async () => {
    const events: Events = [];
    const db = makeDb(events);
    const svc = makeService(events, {});

    await svc.recordRefusedMessage(
      db,
      'app-1',
      'user-1',
      'will I be approved?',
      SAFE_FALLBACK,
      { clientMsgId: ID, onAccepted: () => events.push('accepted') },
    );

    expect(events).toEqual(['insert:user', 'accepted', 'insert:assistant']);
    expect(db.inserts[0]).toMatchObject({ id: ID, role: 'user' });
  });
});

describe('withoutRefusedTurns — refused exchanges never reach the model', () => {
  it('drops the refusal and the message it answered, keeps everything else', () => {
    const rows = [
      { role: 'assistant', content: 'Are you married?' },
      { role: 'user', content: 'will I be approved?' },
      { role: 'assistant', content: SAFE_FALLBACK },
      { role: 'user', content: 'yes, married' },
      { role: 'assistant', content: 'Since when?' },
    ];
    expect(withoutRefusedTurns(rows).map((r) => r.content)).toEqual([
      'Are you married?',
      'yes, married',
      'Since when?',
    ]);
  });
});
