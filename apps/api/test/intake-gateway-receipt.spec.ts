import { ConflictException } from '@nestjs/common';
import { IntakeGateway } from '../src/modules/intake/intake.gateway';
import {
  DuplicateIntakeMessageError,
  MESSAGE_IN_PROGRESS,
} from '../src/modules/intake/intake.service';

/**
 * `intake:received` — the receipt the browser waits for before it considers an
 * applicant's message safe — and the client id that ties every event of a turn
 * to the message it is about.
 *
 * Prod 2026-10-21 / 2026-10-24: messages typed after an API restart, or while
 * the session refresh was failing, never reached this gateway and the browser
 * showed nothing. The browser now keeps the message marked "sending" until the
 * receipt arrives. The receipt therefore has to mean STORED: sent from the
 * service's `onAccepted`, never on arrival.
 */
const ID = '7f1c2a9e-3b4d-4c5e-8f60-123456789abc';

describe('IntakeGateway — message receipt', () => {
  function makeClient(
    data: { userId?: string; accessToken?: string } = {
      userId: 'user-1',
      accessToken: 'token-1',
    },
  ) {
    const emitted: Array<{ event: string; payload: any }> = [];
    const client = {
      data,
      join: jest.fn(),
      to: jest.fn(() => ({ emit: jest.fn() })),
      emit: (event: string, payload: unknown) => {
        emitted.push({ event, payload });
      },
    };
    return { client, emitted };
  }

  const supabase = { forUser: () => ({}) } as never;

  function gateway(
    intake: Record<string, jest.Mock>,
    safe = true,
  ): IntakeGateway {
    return new IntakeGateway(
      { getMessages: jest.fn().mockResolvedValue([]), ...intake } as never,
      supabase,
      {
        classifyIntent: jest
          .fn()
          .mockReturnValue(safe ? { safe: true } : { safe: false, label: 'x' }),
        filterOutput: jest.fn().mockReturnValue({ safe: true, violations: [] }),
        refusalMessage: 'refused',
      },
    );
  }

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('acknowledges only when the service has stored the message', async () => {
    const { client, emitted } = makeClient();
    let eventsBeforeAccept: string[] = [];
    const intake = {
      sendMessage: jest.fn((_db, _id, _uid, _text, hooks, opts) => {
        eventsBeforeAccept = emitted.map((e) => e.event);
        opts.onAccepted();
        hooks.onReady('Next?', false);
        return Promise.resolve({ currentQuestion: 'Next?', isComplete: false });
      }),
    };

    await gateway(intake).handleMessage(client as never, {
      applicationId: 'app-1',
      text: 'correction',
      clientMsgId: ID,
    });

    expect(eventsBeforeAccept).toEqual([]);
    expect(emitted.map((e) => e.event)).toEqual([
      'intake:received',
      'intake:message',
    ]);
    expect(emitted[0].payload).toEqual({ clientMsgId: ID });
    expect(emitted[1].payload.clientMsgId).toBe(ID);
  });

  it('a held message lock: no receipt, a clear error naming the message', async () => {
    const { client, emitted } = makeClient();
    const intake = {
      sendMessage: jest.fn(() =>
        Promise.reject(new ConflictException(MESSAGE_IN_PROGRESS)),
      ),
    };

    await gateway(intake).handleMessage(client as never, {
      applicationId: 'app-1',
      text: 'correction',
      clientMsgId: ID,
    });

    expect(emitted.map((e) => e.event)).toEqual([
      'intake:token:abort',
      'intake:error',
    ]);
    expect(emitted[1].payload).toEqual({
      message: expect.stringMatching(
        /previous message is still being answered/,
      ),
      retryable: true,
      clientMsgId: ID,
    });
  });

  it('a resend of an answered message is re-acknowledged and re-synced (full history shape), not re-run', async () => {
    const { client, emitted } = makeClient();
    const snap = {
      messages: [{ id: ID, role: 'user', content: 'yes' }],
      checklistItems: [{ id: 'c1' }],
      isComplete: true,
    };
    const intake = {
      sendMessage: jest.fn(() =>
        Promise.reject(new DuplicateIntakeMessageError(ID)),
      ),
      snapshot: jest.fn().mockResolvedValue(snap),
    };

    await gateway(intake).handleMessage(client as never, {
      applicationId: 'app-1',
      text: 'yes',
      clientMsgId: ID,
    });

    expect(emitted.map((e) => e.event)).toEqual([
      'intake:received',
      'intake:history',
    ]);
    // Same shape as intake:start's: the checklist and completion survive.
    expect(emitted[1].payload).toEqual({ ...snap, receipts: true });
  });

  it("a delivered reply pings the user's other sockets on this application", async () => {
    const { client } = makeClient();
    const roomEmit = jest.fn();
    client.to = jest.fn(() => ({ emit: roomEmit }));
    const intake = {
      sendMessage: jest.fn((_db, _id, _uid, _text, hooks, opts) => {
        opts.onAccepted();
        hooks.onReady('Next?', false);
        return Promise.resolve({ currentQuestion: 'Next?', isComplete: false });
      }),
    };

    await gateway(intake).handleMessage(client as never, {
      applicationId: 'app-1',
      text: 'x',
      clientMsgId: ID,
    });

    expect(client.to).toHaveBeenCalledWith('intake:user-1:app-1');
    expect(roomEmit).toHaveBeenCalledWith('intake:refresh', {
      applicationId: 'app-1',
    });
  });

  it('joins the per-user room only after intake:start proved access', async () => {
    const denied = makeClient();
    const allowed = makeClient();
    const gw = gateway({
      startOrResume: jest
        .fn()
        .mockRejectedValueOnce(new Error('Access denied'))
        .mockResolvedValueOnce({ checklistItems: [], isComplete: false }),
    });

    await gw.handleStart(denied.client as never, { applicationId: 'app-1' });
    await gw.handleStart(allowed.client as never, { applicationId: 'app-1' });

    expect(denied.client.join).not.toHaveBeenCalled();
    expect(allowed.client.join).toHaveBeenCalledWith('intake:user-1:app-1');
  });

  it('normalises the client id to lower case (Postgres returns uuids lower-cased)', async () => {
    const { client, emitted } = makeClient();
    const intake = {
      sendMessage: jest.fn((_db, _id, _uid, _text, _hooks, opts) => {
        opts.onAccepted();
        return Promise.resolve({ currentQuestion: 'Q', isComplete: false });
      }),
    };

    await gateway(intake).handleMessage(client as never, {
      applicationId: 'app-1',
      text: 'x',
      clientMsgId: ID.toUpperCase(),
    });

    expect(intake.sendMessage.mock.calls[0][5].clientMsgId).toBe(ID);
    expect(emitted[0].payload).toEqual({ clientMsgId: ID });
  });

  it('a guardrail refusal is recorded, then acknowledged and answered', async () => {
    const { client, emitted } = makeClient();
    const intake = {
      sendMessage: jest.fn(),
      recordRefusedMessage: jest.fn((_db, _id, _uid, _text, _refusal, opts) => {
        opts.onAccepted();
        return Promise.resolve();
      }),
    };

    await gateway(intake, false).handleMessage(client as never, {
      applicationId: 'app-1',
      text: 'guarantee my approval',
      clientMsgId: ID,
    });

    expect(intake.sendMessage).not.toHaveBeenCalled();
    expect(intake.recordRefusedMessage).toHaveBeenCalledWith(
      expect.anything(),
      'app-1',
      'user-1',
      'guarantee my approval',
      'refused',
      expect.objectContaining({ clientMsgId: ID }),
    );
    expect(emitted.map((e) => e.event)).toEqual([
      'intake:received',
      'intake:message',
    ]);
    expect(emitted[1].payload).toMatchObject({
      content: 'refused',
      clientMsgId: ID,
    });
  });

  it('does not acknowledge an unauthenticated socket — it gets the error only', async () => {
    const { client, emitted } = makeClient({});
    const intake = { sendMessage: jest.fn() };

    await gateway(intake).handleMessage(client as never, {
      applicationId: 'app-1',
      text: 'x',
      clientMsgId: ID,
    });

    expect(emitted.map((e) => e.event)).toEqual(['intake:error']);
    expect(emitted[0].payload.clientMsgId).toBe(ID);
    expect(intake.sendMessage).not.toHaveBeenCalled();
  });

  it('ignores an id that is not a UUID (older clients, junk payloads)', async () => {
    const intake = {
      sendMessage: jest.fn((_db, _id, _uid, _text, _hooks, opts) => {
        opts.onAccepted?.();
        return Promise.resolve({ currentQuestion: 'Q', isComplete: false });
      }),
    };
    const gw = gateway(intake);

    for (const clientMsgId of [undefined, 'z'.repeat(65), '123-abc']) {
      const { client, emitted } = makeClient();
      await gw.handleMessage(client as never, {
        applicationId: 'app-1',
        text: 'x',
        clientMsgId,
      });
      expect(emitted.some((e) => e.event === 'intake:received')).toBe(false);
      expect(emitted.some((e) => e.event === 'intake:message')).toBe(true);
    }
    for (const call of intake.sendMessage.mock.calls) {
      expect(call[5].clientMsgId).toBeUndefined();
    }
  });
});
