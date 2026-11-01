import { Logger, Optional } from '@nestjs/common';
import {
  isProbed,
  pageMatches,
  selectPageGroups,
} from '../portal-fill/page-groups';
import {
  isProgressivePage,
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
import type {
  PortalFillStageMessage,
  ReadbackTokenPayload,
  SignedWriteIntent,
} from '@visaai/types';
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
import { PreflightMappingService } from '../preflight/preflight-mapping.service';

interface AutomationSocket extends Socket {
  data: {
    sessionId?: string;
    applicationId?: string;
    userId?: string;
    /** Absolute end of this connect token's resume window (never extended). */
    resumableUntil?: number;
  };
}

/** Quiet time before looking again for questions a progressive page revealed. */
const REVEAL_SETTLE_MS = 300;

/** How long the extension gets to bind a portal tab before the run is abandoned. */
// Long enough for the applicant to switch from VisaAI to the portal tab — and,
// when IRCC signed them out, to sign in and open the draft (live 2026-10-17):
// the extension waits up to 170 s for a form page before binding (sidepanel.ts).
const BIND_ACK_TIMEOUT_MS = 180_000;

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
  private readonly logger = new Logger(AutomationGateway.name);

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
    // What the assistant leaves on each page, for the side panel's opt-in
    // auto-advance (it never presses "Save and continue" while any is left).
    // Optional: without it `left` is omitted and auto-advance stops.
    @Optional() private preflightMapping?: PreflightMappingService,
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
    client.data.resumableUntil = resumableUntil;

    await client.join(`session:${payload.sessionId}`);

    const portalUrl = await this.automation.getSessionPortalUrl(
      payload.sessionId,
    );
    // The route's portal: the panel scopes page detection to it, so a page
    // of another IRCC application flow reads "wrong portal" (live
    // 2026-10-30). Best effort — null keeps the old, unscoped behaviour.
    const portalId = await this.automation
      .getApplicationPortalId(payload.applicationId)
      .catch(() => null);

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
      portalId,
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

    // The panel lists each step by the label the applicant confirmed, not its
    // key ("ircc_upload_passport"). Added after signing: display only.
    const intents = this.signer.sign(plan, executionId).map((i) => {
      const label = payload.mappings.find(
        (m) =>
          m.fieldKey === i.fieldKey &&
          m.targetField === i.selector &&
          (m.page ?? '') === (i.page ?? ''),
      )?.label;
      return label ? { ...i, label } : i;
    });

    this.transport.bind(executionId, client, applicationId);

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
      probed.map((i) => i.awaitOptions === true),
    );
    const selection =
      probe === null
        ? null
        : selectPageGroups(
            intents,
            probe.results,
            probe.page,
            isProgressivePage,
          );
    if (selection === null || !selection.ok) {
      this.transport.unbind(executionId);
      // The approval is still good (the lock was revalidated above); only this
      // page could not be filled. Keep the applicant's next page fillable.
      await this.renew(client, payload);
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
      // A screen of a progressive page with none of its questions on it (an
      // information screen, a fee question of the study questionnaire) is
      // not a failure: the applicant answers it and the next screen fills.
      const progressiveScreen =
        selection !== null &&
        selection.reason === 'none_present' &&
        !!probe?.page &&
        intents.some(
          (i) =>
            i.page != null &&
            pageMatches(probe.page as string, i.page) &&
            isProgressivePage(i.page),
        );
      client.emit('automation:error', {
        message:
          selection === null
            ? 'Could not read the portal page. Nothing was filled. If the extension was just updated, reload the portal tab and launch again.'
            : selection.reason === 'option_missing'
              ? `IRCC's list on this screen has no option for the reviewed answer to: ${selection.missing
                  .map(
                    (sel) =>
                      payload.mappings.find((m) => m.targetField === sel)
                        ?.label ?? 'a question',
                  )
                  .join(
                    '; ',
                  )}. Nothing was filled on this screen — answer it yourself, then press Next.`
              : progressiveScreen
                ? 'Nothing to fill on this screen: answer it yourself and press Next. Keep this panel open — the questions the assistant has answers for fill when they appear.'
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
    // A progressive page (IRCC eTA): after the targets present now, look
    // again for what those answers revealed, and fill that too. Only this
    // page's own signed intents, only while the tab is still on its path.
    let waiting = selection.waiting ?? [];
    const runPage = selection.pages[0] ?? '';
    const more = selection.waiting
      ? async (): Promise<SignedWriteIntent[]> => {
          if (waiting.length === 0) return [];
          await new Promise((r) => setTimeout(r, REVEAL_SETTLE_MS));
          const again = await this.transport.probePage(
            executionId,
            waiting.map((i) => i.selector),
            waiting.map((i) => i.op ?? null),
            // A select still loading its options is there: the write waits.
            waiting.map((i) => i.awaitOptions === true),
          );
          if (!again?.page || !pageMatches(again.page, runPage)) return [];
          const found = new Set(
            again.results.filter((r) => r.found).map((r) => r.selector),
          );
          const now = waiting.filter((i) => found.has(i.selector));
          waiting = waiting.filter((i) => !found.has(i.selector));
          return now;
        }
      : undefined;
    const labelOf = (fieldKey: string | undefined) =>
      payload.mappings.find(
        (m) =>
          m.fieldKey === fieldKey &&
          (m.page ?? '') === (selection.pages[0] ?? ''),
      )?.label;

    // Whether this run's end was reported to the panel. A run that threw (an
    // audit write or a status update failing mid-run) reported nothing and
    // skipped the renewal: the panel kept the run bound and had no approval
    // for the next page, so no later page filled. One page failing must not
    // stop the pages after it: report it as failed and renew.
    let reported = false;
    try {
      const result = await this.orchestrator.run(
        applicationId,
        executionId,
        runIntents,
        actor,
        more,
      );

      if (result.state === 'COMPLETED') {
        // 'active', not 'complete': one launch now covers every portal page,
        // and only a pending/active/paused session may be resumed after a
        // dropped connection. Marking it complete after the first page made
        // every later drop unrecoverable (dry run 2026-10-16).
        await this.statusQuietly(sessionId, 'active');
        const left = selection.waiting
          ? undefined
          : await this.leftOnPage(applicationId, runPage);
        reported = true;
        this.stage(client, {
          executionId,
          stage: 'completed',
          filledPages: selection.pages.filter((p) => p !== ''),
          nextPage: next,
          ...(selection.waiting
            ? { remaining: remainingLabels(waiting, payload.mappings) }
            : {}),
          ...(left ? { left } : {}),
        });
      } else {
        await this.statusQuietly(
          sessionId,
          'active',
          `Field ${result.failedField ?? 'unknown'} failed: ${result.haltReason ?? 'unknown'}`,
        );
        reported = true;
        this.stage(client, {
          executionId,
          stage: 'failed',
          reason: result.haltReason,
          failedFieldKey: result.failedField,
          failedLabel: labelOf(result.failedField),
          nextPage: next,
        });
      }
    } catch (err) {
      this.logger.error(
        `portal-fill run threw (application ${applicationId}, execution ${executionId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // Best effort: the audit store may be what failed.
      await this.blocked(applicationId, sessionId, userId, 'run_threw').catch(
        () => undefined,
      );
      if (!reported)
        this.stage(client, {
          executionId,
          stage: 'failed',
          reason: 'transport_error',
          nextPage: next,
        });
    } finally {
      // Unbind whatever happened. A run that ended must not leave a socket
      // authorized to receive intents for it.
      this.transport.unbind(executionId);
    }
    await this.renew(client, payload);
  }

  /**
   * Labels of what the assistant leaves for the applicant on `page` (the
   * review's coverage). Undefined when unknown — no service, no page, or the
   * lookup failed — which the side panel treats as "do not auto-advance".
   * Display data only: it never changes what is written.
   */
  private async leftOnPage(
    applicationId: string,
    page: string,
  ): Promise<string[] | undefined> {
    if (!this.preflightMapping || !page) return undefined;
    try {
      const coverage = await this.preflightMapping.coverage(applicationId);
      if (!coverage) return undefined;
      const pg = coverage.pages.find((p) => p.page === page);
      return pg ? pg.left.map((l) => l.label) : undefined;
    } catch {
      return undefined;
    }
  }

  /** The session's status, best effort: a failed update never ends a run's report. */
  private async statusQuietly(
    sessionId: string,
    status: 'active',
    message?: string,
  ): Promise<void> {
    try {
      await (message === undefined
        ? this.automation.updateStatus(sessionId, status)
        : this.automation.updateStatus(sessionId, status, message));
    } catch {
      // The run's own audit trail records the outcome.
    }
  }

  /**
   * One launch covers the whole portal, page by page. The extension follows
   * the applicant to the next IRCC page and starts the next run with this
   * token; before, every page needed a fresh launch from VisaAI (dry run
   * 2026-10-16: ~24 launches for one application).
   *
   * Only issued at the end of a run whose plan was rebuilt and whose live lock
   * matched, to the socket that ran it, with the same application, session,
   * user, review and mappings. The 15-minute window restarts, so active use
   * keeps it alive and an abandoned session still lapses. Every later run
   * revalidates the lock live exactly as the first one did.
   */
  private async renew(client: AutomationSocket, payload: ReadbackTokenPayload) {
    const { issuedAt: _issuedAt, ...rest } = payload;
    // The resume token minted at connect lives 5 minutes; a session that
    // follows the applicant through ~24 pages outlives it, and the first
    // dropped connection after that ended the session. Rotate it with every
    // renewal, inside the connect token's absolute window.
    let resumeToken: string | null = null;
    const { sessionId, applicationId, userId, resumableUntil } = client.data;
    if (sessionId && applicationId && userId && resumableUntil) {
      try {
        resumeToken = await this.tokens.mintResume(
          { sessionId, applicationId, userId },
          resumableUntil,
        );
      } catch {
        resumeToken = null;
      }
    }
    try {
      client.emit('portal-fill:renewed', {
        protocol: PORTAL_FILL_PROTOCOL_VERSION,
        readbackToken: this.readbackTokens.mint(rest),
        ...(resumeToken ? { resumeToken } : {}),
      });
    } catch {
      // The socket went away: nothing to keep alive.
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

/**
 * Labels of a progressive page's targets still not on it, as the applicant
 * reads them: a date's three selects and a "confirm" field are one answer.
 */
function remainingLabels(
  waiting: SignedWriteIntent[],
  mappings: ReadonlyArray<{
    fieldKey: string;
    targetField: string;
    page?: string;
    label?: string;
  }>,
): string[] {
  const out: string[] = [];
  for (const i of waiting) {
    const m = mappings.find(
      (x) =>
        x.fieldKey === i.fieldKey &&
        x.targetField === i.selector &&
        (x.page ?? '') === (i.page ?? ''),
    );
    const label = (m?.label ?? i.fieldKey)
      .replace(/ — (year|month|day)$/, '')
      .replace(/ \(confirm\)$/, '');
    if (!out.includes(label)) out.push(label);
  }
  return out;
}
