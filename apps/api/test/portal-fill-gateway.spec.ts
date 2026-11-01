import { Logger } from '@nestjs/common';
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
  const readbackTokens = {
    verify: over.verify ?? (() => payload()),
    mint: jest.fn(
      (p: Omit<ReadbackTokenPayload, 'issuedAt'>) => `renewed:${p.sessionId}`,
    ),
  };
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

  const tokens = {
    mintResume: jest.fn(async () => 'resume-2'),
  };
  const gateway = new AutomationGateway(
    tokens as never,
    automation as never,
    audit as never,
    readbackTokens as never,
    writePlans as never,
    signer as never,
    orchestrator as never,
    transport,
  );
  return {
    gateway,
    audit,
    automation,
    signer,
    orchestrator,
    transport,
    readbackTokens,
  };
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
    // The session continues to the next page (one launch, every page).
    expect(automation.updateStatus).toHaveBeenCalledWith(SESSION, 'active');
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

describe('AutomationGateway — one launch follows the portal (dry run 2026-10-16)', () => {
  const renewed = (c: ReturnType<typeof makeClient>) =>
    c.emitted.filter((e) => e.event === 'portal-fill:renewed');

  it('renews the approval after a completed page, same scope, fresh window', async () => {
    const { gateway, readbackTokens } = build();
    const client = makeClient();
    await gateway.handlePortalFillStart(client as never, {
      readbackToken: 't',
    });
    expect(renewed(client)).toHaveLength(1);
    expect(renewed(client)[0].payload).toMatchObject({
      readbackToken: `renewed:${SESSION}`,
    });
    const minted = readbackTokens.mint.mock.calls[0][0];
    expect(minted).not.toHaveProperty('issuedAt');
    expect(minted).toMatchObject({
      applicationId: APP,
      sessionId: SESSION,
      userId: USER,
      lockedDiffHash: LOCK,
    });
  });

  it('renews on a page with nothing to fill, so the next page still fills', async () => {
    const { gateway } = build({ probe: [] });
    const client = makeClient();
    await gateway.handlePortalFillStart(client as never, {
      readbackToken: 't',
    });
    expect(renewed(client)).toHaveLength(1);
  });

  it('a run that throws is reported as failed and still renews, so later pages fill', async () => {
    const { gateway, transport } = build({
      run: jest.fn().mockRejectedValue(new Error('audit insert failed')),
    });
    const unbind = jest.spyOn(transport, 'unbind');
    const client = makeClient();
    await expect(
      gateway.handlePortalFillStart(client as never, { readbackToken: 't' }),
    ).resolves.toBeUndefined();
    expect(stages(client)).toContainEqual(
      expect.objectContaining({ stage: 'failed', reason: 'transport_error' }),
    );
    expect(unbind).toHaveBeenCalled();
    expect(renewed(client)).toHaveLength(1);
  });

  it('a run that throws is logged and audited as run_threw', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const { gateway, audit } = build({
      run: jest.fn().mockRejectedValue(new Error('boom')),
    });
    const client = makeClient();
    await gateway.handlePortalFillStart(client as never, {
      readbackToken: 't',
    });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/app-1.*boom/s));
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: APP,
        payload: expect.objectContaining({ reason: 'run_threw' }),
      }),
    );
    log.mockRestore();
  });

  it('a failing audit of the thrown run does not stop the report or the renewal', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const { gateway, audit } = build({
      run: jest.fn().mockRejectedValue(new Error('boom')),
    });
    audit.append.mockRejectedValue(new Error('audit down'));
    const client = makeClient();
    await expect(
      gateway.handlePortalFillStart(client as never, { readbackToken: 't' }),
    ).resolves.toBeUndefined();
    expect(stages(client)).toContainEqual(
      expect.objectContaining({ stage: 'failed' }),
    );
    expect(renewed(client)).toHaveLength(1);
    log.mockRestore();
  });

  it('a status update that fails does not swallow the page report or the renewal', async () => {
    const { gateway, automation } = build();
    automation.updateStatus.mockRejectedValue(new Error('db down'));
    const client = makeClient();
    await gateway.handlePortalFillStart(client as never, {
      readbackToken: 't',
    });
    expect(stages(client)).toContainEqual(
      expect.objectContaining({ stage: 'completed' }),
    );
    expect(renewed(client)).toHaveLength(1);
  });

  it('never renews an invalid token', async () => {
    const { gateway } = build({ verify: () => null });
    const client = makeClient();
    await gateway.handlePortalFillStart(client as never, {
      readbackToken: 'x',
    });
    expect(renewed(client)).toHaveLength(0);
  });

  it('never renews when the lock changed since the token', async () => {
    const { gateway } = build({
      buildPlan: () => Promise.resolve(plan({ lockedDiffHash: 'other' })),
    });
    const client = makeClient();
    await gateway.handlePortalFillStart(client as never, {
      readbackToken: 't',
    });
    expect(renewed(client)).toHaveLength(0);
  });

  it('never renews when the write plan is rejected', async () => {
    const { gateway } = build({
      buildPlan: () => Promise.reject(new Error('lock gone')),
    });
    const client = makeClient();
    await gateway.handlePortalFillStart(client as never, {
      readbackToken: 't',
    });
    expect(renewed(client)).toHaveLength(0);
  });
});

describe('AutomationGateway — a multi-page session stays resumable (dry run 2026-10-16)', () => {
  it('keeps the session active after a page, and rotates the resume token', async () => {
    const { gateway, automation } = build();
    const client = makeClient();
    client.data = {
      ...client.data,
      resumableUntil: Date.now() + 60_000,
    } as never;
    await gateway.handlePortalFillStart(client as never, {
      readbackToken: 't',
    });
    expect(automation.updateStatus).toHaveBeenCalledWith(SESSION, 'active');
    expect(automation.updateStatus).not.toHaveBeenCalledWith(
      SESSION,
      'complete',
    );
    const renewed = client.emitted.find(
      (e) => e.event === 'portal-fill:renewed',
    );
    expect(renewed?.payload).toMatchObject({ resumeToken: 'resume-2' });
  });
});
