import { IntakeGateway } from '../src/modules/intake/intake.gateway';

/**
 * The contract between the streamed preview and the reply that is actually
 * delivered.
 *
 * The applicant used to see nothing but "Thinking…" for the whole generation,
 * so the gateway now forwards the model's chunks as they arrive. That makes an
 * ordering problem the tests have to pin down: `filterOutput` — the guardrail
 * that stops an approval guarantee or outcome prediction reaching a user — can
 * only run on the COMPLETE reply. Streaming is therefore a preview the browser
 * is required to discard, and `intake:message` remains the only authoritative
 * delivery. If that inverts, the guardrail becomes decorative.
 */
describe('IntakeGateway — streamed preview vs delivered reply', () => {
  function makeClient() {
    const emitted: Array<{ event: string; payload: unknown }> = [];
    const client = {
      data: { userId: 'user-1', accessToken: 'token-1' },
      join: jest.fn(),
      to: jest.fn(() => ({ emit: jest.fn() })),
      emit: (event: string, payload: unknown) => {
        emitted.push({ event, payload });
      },
    };
    return { client, emitted };
  }

  const supabase = { forUser: () => ({}) } as never;

  function gatewayWith(
    intake: { sendMessage: jest.Mock },
    guardrails: Partial<{
      classifyIntent: jest.Mock;
      filterOutput: jest.Mock;
      refusalMessage: string;
    }> = {},
  ) {
    return new IntakeGateway(intake as never, supabase, {
      classifyIntent: jest.fn().mockReturnValue({ safe: true }),
      filterOutput: jest.fn().mockReturnValue({ safe: true, violations: [] }),
      refusalMessage: 'refused',
      ...guardrails,
    });
  }

  it('streams each chunk, then delivers the reply once', async () => {
    const intake = {
      sendMessage: jest.fn((_db, _id, _uid, _text, hooks) => {
        hooks.onToken('Where ');
        hooks.onToken('will you stay?');
        hooks.onReady('Where will you stay?', false);
        return Promise.resolve({
          currentQuestion: 'Where will you stay?',
          checklistItems: [],
        });
      }),
    };
    const { client, emitted } = makeClient();

    await gatewayWith(intake).handleMessage(client as never, {
      applicationId: 'app-1',
      text: 'tourism',
    });

    const tokens = emitted.filter((e) => e.event === 'intake:token');
    const messages = emitted.filter((e) => e.event === 'intake:message');
    expect(tokens.map((t) => (t.payload as { delta: string }).delta)).toEqual([
      'Where ',
      'will you stay?',
    ]);
    expect(messages).toHaveLength(1);
    expect((messages[0]?.payload as { content: string }).content).toBe(
      'Where will you stay?',
    );
  });

  it('tags the tokens and the closing message with the SAME turn id', async () => {
    // Without this the browser cannot tell two overlapping turns apart and
    // splices their text together.
    const intake = {
      sendMessage: jest.fn((_db, _id, _uid, _text, hooks) => {
        hooks.onToken('a');
        hooks.onReady('a', false);
        return Promise.resolve({ currentQuestion: 'a', checklistItems: [] });
      }),
    };
    const { client, emitted } = makeClient();

    await gatewayWith(intake).handleMessage(client as never, {
      applicationId: 'app-1',
      text: 'hi',
    });

    const ids = emitted
      .filter((e) => ['intake:token', 'intake:message'].includes(e.event))
      .map((e) => (e.payload as { turnId?: string }).turnId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBeTruthy();
    expect(new Set(ids).size).toBe(1);
  });

  it('delivers the guardrail fallback, not the text that streamed', async () => {
    // The whole point of the preview being non-authoritative.
    const unsafe = 'You are guaranteed to be approved.';
    const intake = {
      sendMessage: jest.fn((_db, _id, _uid, _text, hooks) => {
        hooks.onToken(unsafe);
        hooks.onReady(unsafe, false);
        return Promise.resolve({ currentQuestion: unsafe, checklistItems: [] });
      }),
    };
    const { client, emitted } = makeClient();

    await gatewayWith(intake, {
      filterOutput: jest.fn().mockReturnValue({
        safe: false,
        // The suppression log names the rules that fired, so a stub without
        // them throws inside `deliver` and the fallback never reaches the
        // client — the exact failure this test exists to catch.
        violations: ['guarantee'],
        safeFallback: 'I cannot predict that.',
      }),
    }).handleMessage(client as never, {
      applicationId: 'app-1',
      text: 'will i get it?',
    });

    const delivered = emitted.find((e) => e.event === 'intake:message');
    expect((delivered!.payload as { content: string }).content).toBe(
      'I cannot predict that.',
    );
    expect((delivered!.payload as { content: string }).content).not.toBe(
      unsafe,
    );
  });

  it('aborts the stream before the error so no half sentence is left on screen', async () => {
    const intake = {
      sendMessage: jest.fn((_db, _id, _uid, _text, hooks) => {
        hooks.onToken('Where wi');
        return Promise.reject(new Error('upstream exploded'));
      }),
    };
    const { client, emitted } = makeClient();

    await gatewayWith(intake).handleMessage(client as never, {
      applicationId: 'app-1',
      text: 'tourism',
    });

    const events = emitted.map((e) => e.event);
    expect(events).toContain('intake:token:abort');
    expect(events).toContain('intake:error');
    // Order matters: clear the partial reply, THEN explain.
    expect(events.indexOf('intake:token:abort')).toBeLessThan(
      events.indexOf('intake:error'),
    );
    expect(events).not.toContain('intake:message');
  });

  it('does not open a stream for a turn refused before the model runs', async () => {
    // The refused exchange is recorded (so a reload still shows it), but the
    // graph — and so the stream — never runs.
    const intake = {
      sendMessage: jest.fn(),
      recordRefusedMessage: jest.fn().mockResolvedValue(undefined),
    };
    const { client, emitted } = makeClient();

    await gatewayWith(intake, {
      classifyIntent: jest
        .fn()
        .mockReturnValue({ safe: false, label: 'legal_advice' }),
    }).handleMessage(client as never, {
      applicationId: 'app-1',
      text: 'should i lie on the form',
    });

    expect(intake.sendMessage).not.toHaveBeenCalled();
    expect(emitted.map((e) => e.event)).toEqual(['intake:message']);
  });
});

/**
 * The applicant used to wait out the ENTIRE graph before the reply appeared,
 * because `update_checklist` — a full structured generation — sat between
 * their answer and the question. That node is no longer part of a turn at all
 * (it runs once, when the documents surface is opened), but the graph still
 * settles LATER than the reply exists: the checkpoint save and the transcript
 * write both follow it.
 * These tests hold the delivery to the moment the reply exists.
 */
describe('IntakeGateway — delivery does not wait for the graph', () => {
  function makeClient() {
    const emitted: Array<{ event: string; payload: unknown }> = [];
    return {
      client: {
        data: { userId: 'user-1', accessToken: 'token-1' },
        join: jest.fn(),
        to: jest.fn(() => ({ emit: jest.fn() })),
        emit: (event: string, payload: unknown) => {
          emitted.push({ event, payload });
        },
      },
      emitted,
    };
  }

  function gatewayWith(intake: { sendMessage: jest.Mock }) {
    return new IntakeGateway(
      intake as never,
      { forUser: () => ({}) } as never,
      {
        classifyIntent: jest.fn().mockReturnValue({ safe: true }),
        filterOutput: jest.fn().mockReturnValue({ safe: true, violations: [] }),
        refusalMessage: 'refused',
      },
    );
  }

  it('delivers on onReady, before the graph resolves', async () => {
    const order: string[] = [];
    const intake = {
      sendMessage: jest.fn((_db, _id, _uid, _text, hooks) => {
        hooks.onReady('Where will you stay?', false);
        order.push('reply-ready');
        // Whatever the graph still has to finish once the question exists — the
        // checkpoint save, the transcript write — must not hold the reply.
        return new Promise((resolve) =>
          setImmediate(() => {
            order.push('graph-settled');
            resolve({ currentQuestion: 'Where will you stay?' });
          }),
        );
      }),
    };
    const { client, emitted } = makeClient();

    await gatewayWith(intake).handleMessage(client as never, {
      applicationId: 'app-1',
      text: 'tourism',
    });

    expect(order).toEqual(['reply-ready', 'graph-settled']);
    expect(emitted.filter((e) => e.event === 'intake:message')).toHaveLength(1);
  });

  it('sends the reply and nothing about documents', async () => {
    // The checklist is built when the documents surface is opened, not during a
    // turn. A payload still carrying one would be stale by construction.
    const intake = {
      sendMessage: jest.fn((_db, _id, _uid, _text, hooks) => {
        hooks.onReady('Q?', false);
        return Promise.resolve({ currentQuestion: 'Q?' });
      }),
    };
    const { client, emitted } = makeClient();

    await gatewayWith(intake).handleMessage(client as never, {
      applicationId: 'app-1',
      text: 'hi',
    });

    expect(emitted.map((e) => e.event)).not.toContain('intake:checklist');
    expect(
      emitted.find((e) => e.event === 'intake:message')?.payload,
    ).not.toHaveProperty('checklistItems');
  });

  it('still delivers when the node never runs (intake already complete)', async () => {
    const intake = {
      sendMessage: jest.fn(() =>
        Promise.resolve({
          currentQuestion: null,
          isComplete: true,
          checklistItems: [],
        }),
      ),
    };
    const { client, emitted } = makeClient();

    await gatewayWith(intake).handleMessage(client as never, {
      applicationId: 'app-1',
      text: 'done',
    });

    const message = emitted.find((e) => e.event === 'intake:message');
    expect((message?.payload as { content: string }).content).toBe(
      'Your intake is complete.',
    );
    expect((message?.payload as { isComplete: boolean }).isComplete).toBe(true);
  });

  it('does not replace a delivered reply with an error when the sibling branch fails', async () => {
    // Swapping a good answer for an error banner would be the worse lie: the
    // applicant read a valid question, only the checklist did not rebuild.
    const intake = {
      sendMessage: jest.fn((_db, _id, _uid, _text, hooks) => {
        hooks.onReady('Where will you stay?', false);
        return Promise.reject(new Error('checklist branch exploded'));
      }),
    };
    const { client, emitted } = makeClient();

    await gatewayWith(intake).handleMessage(client as never, {
      applicationId: 'app-1',
      text: 'tourism',
    });

    const events = emitted.map((e) => e.event);
    expect(events).toContain('intake:message');
    expect(events).not.toContain('intake:error');
    expect(events).not.toContain('intake:token:abort');
  });
});
