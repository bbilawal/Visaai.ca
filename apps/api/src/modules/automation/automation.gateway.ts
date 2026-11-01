import {
  isProbed,
  pageMatches,
  selectPageGroups,
} from '../portal-fill/page-groups';
import {
  portalPageOrder,
  portalPageTitle,
} from '../../strategies/portal-integration/portal-fill.registry';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { PORTAL_FILL_PROTOCOL_VERSION } from '@visaai/types';
import type { PortalFillStageMessage } from '@visaai/types';
import {
  RESUME_WINDOW_MS,
  SessionTokenService,
  type TokenPayload,
} from './session-token.service';
import { AutomationService } from './automation.service';
import { AuditService } from '../audit/audit.service';
import { ReadbackTokenService } from '../execution/readback-token.service';
import { WritePlanBuilder } from '../portal-fill/write-plan.builder';
import { WriteIntentSigner } from '../portal-fill/write-intent.signer';
import { PortalFillOrchestrator } from '../portal-fill/portal-fill-orchestrator';
import { SocketExtensionTransport } from '../portal-fill/socket-extension.transport';

interface AutomationSocket extends Socket {
  data: { sessionId?: string; applicationId?: string; userId?: string };
}

/** How long the extension gets to bind a portal tab before the run is abandoned. */
const BIND_ACK_TIMEOUT_MS = 10_000;

// Clients are Chrome extensions (chrome-extension:// origin) — not WEB_URL, so origin
// cannot be restricted here. Security boundary is the single-use token (GETDEL,
// 5-min TTL) redeemed on connect — or, on a reconnect, the single-use rotating
// resume token handed out on the previous connection — NOT CORS. credentials:false ensures no ambient
// cookies are sent cross-origin.
@WebSocketGateway({
  cors: { origin: '*', credentials: false },
  namespace: '/automation',
})
export class AutomationGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  constructor(
    private tokens: SessionTokenService,
    private automation: AutomationService,
    private audit: AuditService,
    private readbackTokens: ReadbackTokenService,
    private writePlans: WritePlanBuilder,
    private signer: WriteIntentSigner,
    private orchestrator: PortalFillOrchestrator,
    private transport: SocketExtensionTransport,
  ) {}

  /**
   * Drop every execution binding this socket held. Without this a disconnected
   * extension would leave its executionId bound, and a later intent for that run
   * would be emitted into a dead socket instead of failing closed immediately.
   */
  handleDisconnect(client: AutomationSocket) {
    this.transport.unbindSocket(client);
  }

  async handleConnection(client: AutomationSocket) {
    const auth = (client.handshake.auth ?? {}) as Record<string, unknown>;
    const token = typeof auth.token === 'string' ? auth.token : undefined;
    const resumeToken =
      typeof auth.resumeToken === 'string' ? auth.resumeToken : undefined;
    if (!token && !resumeToken) {
      client.disconnect();
      return;
    }

    // A reconnect presents the resume token it was handed on its previous
    // connection (item 60); a first connect presents the minted connect token.
    // Resuming re-authenticates the socket only: execution bindings died with
    // the old socket (handleDisconnect), and a fill needs a fresh approval.
    let payload: TokenPayload | null = null;
    let resumableUntil = Date.now() + RESUME_WINDOW_MS;
    const resumed = !!resumeToken;
    if (resumeToken) {
      const r = await this.tokens.redeemResume(resumeToken);
      if (r && (await this.automation.isSessionResumable(r.sessionId))) {
        payload = r;
        resumableUntil = r.resumableUntil;
      }
    } else if (token) {
      payload = await this.tokens.redeem(token);
    }
    if (!payload) {
      // Delay disconnect so the error packet flushes before the socket closes
      client.emit('automation:error', {
        message: resumed
          ? 'Session can no longer be resumed. Start again from the VisaAI submission page.'
          : 'Invalid or expired session token',
      });
      setTimeout(() => client.disconnect(), 50);
      return;
    }
    client.data.sessionId = payload.sessionId;
    client.data.applicationId = payload.applicationId;
    client.data.userId = payload.userId;

    await client.join(`session:${payload.sessionId}`);

    const portalUrl = await this.automation.getSessionPortalUrl(
      payload.sessionId,
    );

    // Best effort: without a resume token this connection still works; it
    // just cannot survive a drop, which is the old behaviour.
    let nextResumeToken: string | null = null;
    try {
      nextResumeToken = await this.tokens.mintResume(payload, resumableUntil);
    } catch {
      nextResumeToken = null;
    }

    // Signal that auth is complete — clients wait for this before emitting automation:start,
    // avoiding a race where start arrives before client.data is populated.
    client.emit('automation:ready', {
      sessionId: payload.sessionId,
      portalUrl,
      resumeToken: nextResumeToken,
      resumed,
    });
  }

  @SubscribeMessage('automation:start')
  async handleStart(@ConnectedSocket() client: AutomationSocket) {
    const { sessionId, applicationId } = client.data;
    if (!sessionId || !applicationId) {
      client.emit('automation:error', { message: 'Unauthorized' });
      return;
    }

    // Phase 4B: legacy socket-fill is deprecated. When disabled (default), do NOT
    // build or emit a fill plan; record an audit-only block and stop. No DOM
    // write is ever requested — the verified server gate is the sole write path.
    if (!this.automation.legacyWriteEnabled()) {
      await this.audit.append({
        applicationId,
        eventType: 'LEGACY_AUTOMATION_BLOCKED',
        actor: { id: client.data.userId ?? null, role: 'system' },
        refs: { submissionSessionId: sessionId },
        payload: {
          path: 'automation:start',
          reason: 'legacy execution deprecated',
        },
      });
      client.emit('automation:error', {
        message:
          'Legacy automation is disabled. Use the verified execution flow.',
      });
      return;
    }

    const instructions = await this.automation.buildInstructions(applicationId);
    await this.automation.updateStatus(sessionId, 'active');

    client.emit('automation:plan', {
      sessionId,
      totalSteps: instructions.length,
      instructions,
    });
  }

  @SubscribeMessage('automation:step-done')
  async handleStepDone(
    @ConnectedSocket() client: AutomationSocket,
    @MessageBody() data: { stepId: string; ok: boolean; detail?: string },
  ) {
    const { sessionId } = client.data;
    if (!sessionId) return;

    if (!data.ok) {
      await this.automation.updateStatus(
        sessionId,
        'error',
        `Step ${data.stepId} failed: ${data.detail ?? 'unknown'}`,
      );
      client.emit('automation:error', {
        message: `Step ${data.stepId} failed`,
      });
    }
  }

  @SubscribeMessage('automation:status')
  async handleStatus(
    @ConnectedSocket() client: AutomationSocket,
    @MessageBody()
    data: { status: 'paused' | 'complete' | 'error'; detail?: string },
  ) {
    const { sessionId } = client.data;
    if (!sessionId) return;
    await this.automation.updateStatus(sessionId, data.status, data.detail);
    client.emit('automation:status-ack', { status: data.status });
  }

  // ── Phase 7J — verified portal-fill execution ────────────────────────────
  // The replacement for the deprecated automation:start path. Authority comes
  // from the signed readback token minted at POST /execution/request, NOT from
  // anything the client sends loose: the mappings are read out of the token, so
  // a client cannot substitute its own field values or selectors.
  @SubscribeMessage('portal-fill:start')
  async handlePortalFillStart(
    @ConnectedSocket() client: AutomationSocket,
    @MessageBody() data: { readbackToken?: string },
  ) {
    const { sessionId, applicationId, userId } = client.data;
    if (!sessionId || !applicationId) {
      client.emit('automation:error', { message: 'Unauthorized' });
      return;
    }

    const payload = this.readbackTokens.verify(data?.readbackToken ?? '');
    if (!payload) {
      await this.blocked(
        applicationId,
        sessionId,
        userId,
        'invalid_readback_token',
      );
      client.emit('automation:error', {
        message: 'Invalid or expired readback token. Re-request execution.',
      });
      return;
    }

    // The token must belong to THIS connection. A token is bound to one
    // application/session/user; presenting someone else's on this socket is a
    // confused-deputy attempt, not a recoverable error.
    if (
      payload.applicationId !== applicationId ||
      payload.sessionId !== sessionId ||
      (userId != null && payload.userId !== userId)
    ) {
      await this.blocked(
        applicationId,
        sessionId,
        userId,
        'readback_token_scope_mismatch',
      );
      client.emit('automation:error', { message: 'Unauthorized' });
      return;
    }

    const executionId = randomUUID();
    const actor = { id: payload.userId, role: 'applicant' as const };

    // Rebuild the plan from the token's mappings. WritePlanBuilder revalidates
    // the preflight lock LIVE, so a lock invalidated since the token was minted
    // (consultant reassigned, approval gone stale, provenance drift) is rejected
    // here even though the token itself is still inside its TTL.
    let plan;
    try {
      plan = await this.writePlans.build(
        payload.applicationId,
        payload.preflightReviewId,
        payload.mappings,
      );
    } catch (err) {
      await this.blocked(
        applicationId,
        sessionId,
        userId,
        'write_plan_rejected',
      );
      client.emit('automation:error', {
        message: err instanceof Error ? err.message : 'Write plan rejected',
      });
      return;
    }

    // Belt and braces: the live lock must still be the one the token was minted
    // against. WritePlanBuilder proves the mappings reproduce the CURRENT lock;
    // this proves the current lock is the SAME lock the user consented to.
    if (plan.lockedDiffHash !== payload.lockedDiffHash) {
      await this.blocked(
        applicationId,
        sessionId,
        userId,
        'lock_changed_since_token',
      );
      client.emit('automation:error', {
        message: 'The reviewed lock changed since execution was approved.',
      });
      return;
    }

    const intents = this.signer.sign(plan, executionId);

    this.transport.bind(executionId, client);

    // Handshake before the first write. The extension must bind the executionId
    // to a concrete portal tab (pf-bind-session) BEFORE any intent is dispatched;
    // otherwise the first field would race the bind and fail closed on a run
    // that was actually fine. The client acks only once its tab is bound.
    const bound = await this.awaitBind(client, executionId);
    if (!bound) {
      this.transport.unbind(executionId);
      await this.blocked(
        applicationId,
        sessionId,
        userId,
        'extension_bind_timeout',
      );
      this.stage(client, {
        executionId,
        stage: 'failed',
        reason: 'transport_error',
      });
      client.emit('automation:error', {
        message:
          'The extension did not bind a portal tab. Open the portal tab and retry.',
      });
      return;
    }

    // Read-only pre-flight. A registered mapping whose selectors do not match
    // the live portal would otherwise write the first N fields and halt on the
    // one that is missing, leaving a half-filled government form. Probe first.
    // Multi-page portals (IRCC) are grouped by page: only groups present in
    // full run, and a half-present group refuses the whole run. `null` means we
    // could not find out, which is not permission to proceed.
    // Only targets present at page load are probed; follow-ups and dialog
    // fields are waited for in order during the run.
    const probed = intents.filter(isProbed);
    const probe = await this.transport.probePage(
      executionId,
      probed.map((i) => i.selector),
      probed.map((i) => i.op ?? null),
    );
    const selection =
      probe === null
        ? null
        : selectPageGroups(intents, probe.results, probe.page);
    if (selection === null || !selection.ok) {
      this.transport.unbind(executionId);
      await this.blocked(
        applicationId,
        sessionId,
        userId,
        selection === null
          ? 'selector_probe_failed'
          : 'selectors_missing_on_portal',
      );
      this.stage(client, {
        executionId,
        stage: 'failed',
        reason: selection === null ? 'transport_error' : 'selector_missing',
      });
      const next = nextMappedPage(intents, probe?.page ?? null);
      client.emit('automation:error', {
        message:
          selection === null
            ? 'Could not read the portal page. Nothing was filled. If the extension was just updated, reload the portal tab and launch again.'
            : selection.reason === 'partial_page'
              ? `This page only partly matches a form section (${selection.missing.length} expected fields missing). Nothing was filled — check you are on the right page.`
              : `The assistant has no reviewed values for this page. Nothing was filled.${
                  next
                    ? ` The next page it fills is "${next.title}" — save this page on IRCC, continue to that page and launch again.`
                    : ''
                }`,
      });
      return;
    }
    const runIntents = selection.intents;
    const next = nextMappedPage(intents, selection.pages[0] ?? null);
    const labelOf = (fieldKey: string | undefined) =>
      payload.mappings.find(
        (m) =>
          m.fieldKey === fieldKey &&
          (m.page ?? '') === (selection.pages[0] ?? ''),
      )?.label;

    try {
      const result = await this.orchestrator.run(
        applicationId,
        executionId,
        runIntents,
        actor,
      );

      if (result.state === 'COMPLETED') {
        await this.automation.updateStatus(sessionId, 'complete');
        this.stage(client, {
          executionId,
          stage: 'completed',
          filledPages: selection.pages.filter((p) => p !== ''),
          nextPage: next,
        });
      } else {
        await this.automation.updateStatus(
          sessionId,
          'error',
          `Field ${result.failedField ?? 'unknown'} failed: ${result.haltReason ?? 'unknown'}`,
        );
        this.stage(client, {
          executionId,
          stage: 'failed',
          reason: result.haltReason,
          failedFieldKey: result.failedField,
          failedLabel: labelOf(result.failedField),
          nextPage: next,
        });
      }
    } finally {
      // Unbind whatever happened. A run that ended must not leave a socket
      // authorized to receive intents for it.
      this.transport.unbind(executionId);
    }
  }

  /**
   * Emit stage:'started' and wait for the extension to confirm it has bound a
   * portal tab. Resolves false on a non-ack, a malformed ack, or the timeout —
   * every one of which means we must NOT start writing.
   */
  private awaitBind(
    client: AutomationSocket,
    executionId: string,
  ): Promise<boolean> {
    const msg: PortalFillStageMessage = {
      protocol: PORTAL_FILL_PROTOCOL_VERSION,
      kind: 'stage',
      executionId,
      stage: 'started',
    };
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (v: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      };
      const timer = setTimeout(() => done(false), BIND_ACK_TIMEOUT_MS);
      try {
        client.emit('portal-fill:stage', msg, (raw: unknown) => {
          const ack = raw as { bound?: boolean; executionId?: string } | null;
          done(ack?.bound === true && ack.executionId === executionId);
        });
      } catch {
        done(false);
      }
    });
  }

  private stage(
    client: AutomationSocket,
    partial: Omit<PortalFillStageMessage, 'protocol' | 'kind'>,
  ) {
    const msg: PortalFillStageMessage = {
      protocol: PORTAL_FILL_PROTOCOL_VERSION,
      kind: 'stage',
      ...partial,
    };
    client.emit('portal-fill:stage', msg);
  }

  private blocked(
    applicationId: string,
    sessionId: string,
    userId: string | undefined,
    reason: string,
  ) {
    return this.audit.append({
      applicationId,
      eventType: 'LEGACY_AUTOMATION_BLOCKED',
      actor: { id: userId ?? null, role: 'system' },
      refs: { submissionSessionId: sessionId },
      payload: { path: 'portal-fill:start', reason },
    });
  }
}

/**
 * The first page after `current`, in portal order, that the run's intents
 * have values for. The intents carry the server's mapping order, which is the
 * portal's page order. With no current page (it did not match a mapping page)
 * the first mapped page is not assumed to be "next": we cannot tell where in
 * the form the applicant is.
 */
function nextMappedPage(
  intents: Array<{ page?: string }>,
  current: string | null,
): { page: string; title: string } | null {
  if (!current) return null;
  const mapped: string[] = [];
  for (const i of intents) {
    if (i.page && !mapped.includes(i.page)) mapped.push(i.page);
  }
  // Portal order from the registry when it knows the page (it also knows the
  // pages the assistant has nothing for); otherwise the intents' own order.
  const anyPage = mapped[0];
  const registered = anyPage ? portalPageOrder(anyPage) : [];
  const order = registered.length > 0 ? registered : mapped;
  const at = order.findIndex((p) => pageMatches(current, p));
  if (at < 0) return null;
  const next = order.slice(at + 1).find((p) => mapped.includes(p));
  if (!next) return null;
  return { page: next, title: portalPageTitle(next) ?? next };
}
