import type { ReadbackTokenPayload, WritePlan } from '@visaai/types';
import { AutomationGateway } from '../src/modules/automation/automation.gateway';
import { SocketExtensionTransport } from '../src/modules/portal-fill/socket-extension.transport';

const APP = 'app-1';
const SESSION = 'sess-1';
const USER = 'user-1';
const LOCK = 'lock-1';

function payload(
  over: Partial<ReadbackTokenPayload> = {},
): ReadbackTokenPayload {
  return {
    applicationId: APP,
    preflightReviewId: 'rev-1',
    sessionId: SESSION,
    userId: USER,
    executionToken: 'tok',
    lockedDiffHash: LOCK,
    mappings: [],
    issuedAt: Date.now(),
    ...over,
  };
}

function plan(over: Partial<WritePlan> = {}): WritePlan {
  return {
    applicationId: APP,
    preflightReviewId: 'rev-1',
    lockedDiffHash: LOCK,
    entries: [],
    planHash: 'ph',
    ...over,
  };
}

/**
 * Socket double. `ackBind` decides whether the client confirms it bound a portal
 * tab — the handshake the server waits on before dispatching any write.
 */
function makeClient(ackBind: boolean | 'silent' = true) {
  const emitted: Array<{ event: string; payload: unknown }> = [];
  return {
    id: 'sock-1',
    data: { sessionId: SESSION, applicationId: APP, userId: USER },
    emitted,
    emit(event: string, p: unknown, ack?: (raw: unknown) => void) {
      emitted.push({ event, payload: p });
      if (ack && ackBind !== 'silent') {
        const executionId = (p as { executionId?: string }).executionId;
        ack(ackBind ? { bound: true, executionId } : { bound: false });
      }
      return true;
    },
  };
}

function build(
  over: {
    verify?: () => ReadbackTokenPayload | null;
    buildPlan?: () => Promise<WritePlan>;
    run?: jest.Mock;
    probe?: { selector: string; found: boolean }[] | null;
    page?: string | null;
  } = {},
) {
  const audit = { append: jest.fn().mockResolvedValue(undefined) };
  const automation = { updateStatus: jest.fn().mockResolvedValue(undefined) };
  const readbackTokens = { verify: over.verify ?? (() => payload()) };
  const writePlans = {
    build: over.buildPlan ?? (() => Promise.resolve(plan())),
  };
  const signer = { sign: jest.fn().mockReturnValue([]) };
  const orchestrator = {
    run:
      over.run ??
      jest.fn().mockResolvedValue({
        executionId: 'e',
        state: 'COMPLETED',
        verified: [],
      }),
  };
  const transport = new SocketExtensionTransport();
  // Default: the portal matches the mapping. Individual tests override.
  jest
    .spyOn(transport, 'probePage')
    .mockImplementation(async (_e, selectors) => {
      const results =
        over.probe === undefined
          ? selectors.map((selector) => ({ selector, found: true }))
          : over.probe;
      return results === null
        ? null
        : { results, page: over.page === undefined ? null : over.page };
    });

  const gateway = new AutomationGateway(
    {} as never,
    automation as never,
    audit as never,
    readbackTokens as never,
    writePlans as never,
    signer as never,
    orchestrator as never,
    transport,
  );
  return { gateway, audit, automation, signer, orchestrator, transport };
}

const stages = (c: ReturnType<typeof makeClient>) =>
  c.emitted
    .filter((e) => e.event === 'portal-fill:stage')
    .map((e) => e.payload);

describe('AutomationGateway — portal-fill:start', () => {
  it('rejects a socket with no redeemed session', async () => {
    const { gateway, orchestrator } = build();
    const client = makeClient();
    client.data = {} as never;

    await gateway.handlePortalFillStart(client as never, {
      readbackToken: 't',
    });

    expect(orchestrator.run).not.toHaveBeenCalled();
    expect(client.emitted[0]).toMatchObject({ event: 'automation:error' });
  });

  it('rejects an invalid or expired readback token and never orchestrates', async () => {
    const { gateway, orchestrator, audit } = build({ verify: () => null });
    const client = makeClient();

    await gateway.handlePortalFillStart(client as never, {
      readbackToken: 'bad',
    });

    expect(orchestrator.run).not.toHaveBeenCalled();
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ reason: 'invalid_readback_token' }),
      }),
    );
  });

  it.each([
    ['another application', { applicationId: 'app-2' }],
    ['another session', { sessionId: 'sess-2' }],
    ['another user', { userId: 'user-2' }],
  ])('refuses a token scoped to %s (confused deputy)', async (_l, over) => {
    const { gateway, orchestrator, audit } = build({
      verify: () => payload(over),
    });
    const client = makeClient();

    await gateway.handlePortalFillStart(client as never, {
      readbackToken: 't',
    });

    expect(orchestrator.run).not.toHaveBeenCalled();
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          reason: 'readback_token_scope_mismatch',
        }),
      }),
    );
  });

  it('refuses when the live lock no longer matches the token lock', async () => {
    const { gateway, orchestrator, audit } = build({
      buildPlan: () =>
        Promise.resolve(plan({ lockedDiffHash: 'lock-CHANGED' })),
    });
    const client = makeClient();

    await gateway.handlePortalFillStart(client as never, {
      readbackToken: 't',
    });

    expect(orchestrator.run).not.toHaveBeenCalled();
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          reason: 'lock_changed_since_token',
        }),
      }),
    );
  });

  it('refuses when the write plan is rejected (lock revalidation failed)', async () => {
    const { gateway, orchestrator, audit } = build({
      buildPlan: () =>
        Promise.reject(new Error('write plan rejected: stale_approval')),
    });
    const client = makeClient();

    await gateway.handlePortalFillStart(client as never, {
      readbackToken: 't',
    });

    expect(orchestrator.run).not.toHaveBeenCalled();
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ reason: 'write_plan_rejected' }),
      }),
    );
  });

  it('does not write a single field until the extension acks a bound tab', async () => {
    const { gateway, orchestrator, audit, transport } = build();
    const client = makeClient(false); // client declines to bind

    await gateway.handlePortalFillStart(client as never, {
      readbackToken: 't',
    });

    expect(orchestrator.run).not.toHaveBeenCalled();
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ reason: 'extension_bind_timeout' }),
      }),
    );
    // and the execution must not stay bound
    expect(
      (stages(client)[0] as { executionId: string }).executionId,
    ).toBeDefined();
    expect(
      transport.isBound(
        (stages(client)[0] as { executionId: string }).executionId,
      ),
    ).toBe(false);
  });

  it('orchestrates after a successful bind and reports completion', async () => {
    const { gateway, orchestrator, automation } = build();
    const client = makeClient(true);

    await gateway.handlePortalFillStart(client as never, {
      readbackToken: 't',
    });

    expect(orchestrator.run).toHaveBeenCalledTimes(1);
    expect(automation.updateStatus).toHaveBeenCalledWith(SESSION, 'complete');
    expect(stages(client)).toEqual([
      expect.objectContaining({ stage: 'started' }),
      expect.objectContaining({ stage: 'completed' }),
    ]);
  });

  it('reports the halted field on a failed run', async () => {
    const { gateway } = build({
      run: jest.fn().mockResolvedValue({
        executionId: 'e',
        state: 'FAILED',
        verified: [],
        failedField: 'surname',
        haltReason: 'value_mismatch',
      }),
    });
    const client = makeClient(true);

    await gateway.handlePortalFillStart(client as never, {
      readbackToken: 't',
    });

    expect(stages(client)[1]).toMatchObject({
      stage: 'failed',
      failedFieldKey: 'surname',
      reason: 'value_mismatch',
    });
  });

  it('unbinds the execution once the run ends', async () => {
    const { gateway, transport } = build();
    const client = makeClient(true);

    await gateway.handlePortalFillStart(client as never, {
      readbackToken: 't',
    });

    const started = stages(client)[0] as { executionId: string };
    expect(transport.isBound(started.executionId)).toBe(false);
  });

  it('mints a fresh executionId per run so intents cannot be replayed across runs', async () => {
    const { gateway } = build();
    const a = makeClient(true);
    const b = makeClient(true);

    await gateway.handlePortalFillStart(a as never, { readbackToken: 't' });
    await gateway.handlePortalFillStart(b as never, { readbackToken: 't' });

    const idA = (stages(a)[0] as { executionId: string }).executionId;
    const idB = (stages(b)[0] as { executionId: string }).executionId;
    expect(idA).not.toEqual(idB);
  });

  it('handleDisconnect releases every binding the socket held', () => {
    const { gateway, transport } = build();
    const client = makeClient();
    transport.bind('exec-x', client);

    gateway.handleDisconnect(client as never);

    expect(transport.isBound('exec-x')).toBe(false);
  });

  describe('selector pre-flight', () => {
    // The mapping must produce at least one intent for the probe to matter.
    const withIntents = (over: Parameters<typeof build>[0] = {}) => {
      const b = build(over);
      b.signer.sign.mockReturnValue([
        {
          executionId: 'x',
          fieldKey: 'given_name',
          selector: '#given-name',
          mappedValue: 'Ada',
          expectedValueHash: 'h',
          category: 'passport',
          lockedDiffHash: LOCK,
          sig: 's',
        },
        {
          executionId: 'x',
          fieldKey: 'surname',
          selector: '#surname',
          mappedValue: 'L',
          expectedValueHash: 'h2',
          category: 'passport',
          lockedDiffHash: LOCK,
          sig: 's2',
        },
      ]);
      return b;
    };

    it('writes NOTHING when a selector is missing from the portal page', async () => {
      const { gateway, orchestrator, audit } = withIntents({
        probe: [
          { selector: '#given-name', found: true },
          { selector: '#surname', found: false },
        ],
      });
      const client = makeClient(true);

      await gateway.handlePortalFillStart(client as never, {
        readbackToken: 't',
      });

      // The whole point: not one field is written, rather than halting halfway.
      expect(orchestrator.run).not.toHaveBeenCalled();
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            reason: 'selectors_missing_on_portal',
          }),
        }),
      );
      expect(stages(client)[1]).toMatchObject({
        stage: 'failed',
        reason: 'selector_missing',
      });
    });

    it('treats an unreadable page as a refusal, not as "all present"', async () => {
      const { gateway, orchestrator, audit } = withIntents({ probe: null });
      const client = makeClient(true);

      await gateway.handlePortalFillStart(client as never, {
        readbackToken: 't',
      });

      expect(orchestrator.run).not.toHaveBeenCalled();
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ reason: 'selector_probe_failed' }),
        }),
      );
    });

    it('proceeds when every mapped selector resolves', async () => {
      const { gateway, orchestrator } = withIntents();
      const client = makeClient(true);

      await gateway.handlePortalFillStart(client as never, {
        readbackToken: 't',
      });

      expect(orchestrator.run).toHaveBeenCalledTimes(1);
    });

    it('releases the binding when the probe refuses the run', async () => {
      const { gateway, transport } = withIntents({ probe: null });
      const client = makeClient(true);

      await gateway.handlePortalFillStart(client as never, {
        readbackToken: 't',
      });

      const started = stages(client)[0] as { executionId: string };
      expect(transport.isBound(started.executionId)).toBe(false);
    });
  });
});
