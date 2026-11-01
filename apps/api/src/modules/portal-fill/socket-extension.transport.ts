import { Injectable, Logger } from '@nestjs/common';
import {
  PORTAL_FILL_PROTOCOL_VERSION,
  isPortalFillProtocolCompatible,
} from '@visaai/types';
import type {
  FieldExecResult,
  PortalFillOp,
  PortalFillFieldResult,
  PortalFillWriteCommand,
  SignedWriteIntent,
} from '@visaai/types';
import type { IExtensionTransport } from './field-executor.port';

/**
 * The only socket surface this transport uses. Declaring it structurally keeps
 * the transport testable without socket.io and keeps PortalFillModule free of a
 * dependency on the gateway (which imports this module, not the other way).
 */
export interface ExtensionSocket {
  readonly id: string;
  emit(event: string, payload: unknown, ack: (raw: unknown) => void): unknown;
}

export const PORTAL_FILL_WRITE_EVENT = 'portal-fill:write';
export const PORTAL_FILL_PROBE_EVENT = 'portal-fill:probe';

/** Whether one mapped selector currently resolves on the bound portal page. */
export interface SelectorProbe {
  selector: string;
  found: boolean;
}

/**
 * The probe has no racer of its own. ExtensionBridgeExecutor supplies the
 * timeout for writes, but nothing wraps probeSelectors — so without this an
 * extension that never acks would hang the run open indefinitely.
 */
const PROBE_TIMEOUT_MS = 10_000;

/**
 * SocketExtensionTransport (Phase 7J) — the concrete `IExtensionTransport` that
 * replaces DisconnectedTransport and carries a signed intent to the bound
 * extension socket.
 *
 * Security properties this class is responsible for:
 *  - Execution-scoped binding. A socket is bound to exactly one executionId;
 *    an intent is only ever emitted to the socket bound to its OWN executionId.
 *    An unbound execution fails closed ('transport_error') — never broadcasts.
 *  - Least authority on the wire. The extension receives a
 *    PortalFillWriteCommand, NOT the SignedWriteIntent: `sig`, `lockedDiffHash`
 *    and `category` never leave the server. The content script has no authority
 *    to mint or re-point an intent, so it is not given the material to try.
 *  - Reply binding. A reply is accepted only if its protocol, executionId and
 *    fieldKey match what was sent. A mismatched or malformed reply is a
 *    'transport_error', never a silent success.
 *  - Never throws, never retries. One emit per call; ExtensionBridgeExecutor
 *    owns replay-suppression, the hard timeout, and the independent hash
 *    re-verification that makes a lying extension harmless.
 */
@Injectable()
export class SocketExtensionTransport implements IExtensionTransport {
  private readonly log = new Logger(SocketExtensionTransport.name);

  /** executionId → the one socket authorized to receive that run's intents. */
  private readonly bound = new Map<string, ExtensionSocket>();

  /**
   * Bind an execution run to a socket. Re-binding the same execution to a new
   * socket replaces the old one: a reconnecting extension must be able to
   * resume, and the previous socket is by definition gone.
   */
  bind(executionId: string, socket: ExtensionSocket): void {
    this.bound.set(executionId, socket);
  }

  unbind(executionId: string): void {
    this.bound.delete(executionId);
  }

  /** Drop every binding held by a socket. Called on disconnect. */
  unbindSocket(socket: ExtensionSocket): void {
    for (const [executionId, bound] of this.bound) {
      if (bound.id === socket.id) this.bound.delete(executionId);
    }
  }

  isBound(executionId: string): boolean {
    return this.bound.has(executionId);
  }

  /**
   * Read-only pre-flight: ask the bound tab which of these selectors actually
   * resolve on the page, before a single value is written.
   *
   * Without this, a portal whose markup does not match the registered mapping
   * fails HALFWAY: fields 1 and 2 are written, field 3 halts on
   * selector_missing, and the applicant is left with a partly-filled government
   * form and no way to have known in advance. With it the run is all-or-nothing.
   *
   * The probe carries selectors out and booleans back. It deliberately does NOT
   * return the field VALUES the page currently holds — the server has no reason
   * to learn what is already typed into someone's visa application, and a probe
   * is not a readback.
   *
   * Returns null when the answer cannot be trusted (no bound socket, no ack,
   * malformed or mismatched reply). Null means "unknown", and the caller must
   * treat unknown as a refusal — never as "all present".
   */
  async probeSelectors(
    executionId: string,
    selectors: string[],
  ): Promise<SelectorProbe[] | null> {
    return (await this.probePage(executionId, selectors))?.results ?? null;
  }

  /**
   * probeSelectors plus the bound tab's URL PATH (never its query, which
   * carries IRCC application ids). Multi-page portals reuse ids across pages,
   * so which page is open is decided by the path, not by which ids happen to
   * resolve. `ops` (parallel to `selectors`) tells the extension which rule a
   * target must pass: a radio input or an "add" button is not a data field.
   * `page` is null when the extension did not report one.
   */
  async probePage(
    executionId: string,
    selectors: string[],
    ops?: Array<PortalFillOp | null>,
  ): Promise<{ results: SelectorProbe[]; page: string | null } | null> {
    const socket = this.bound.get(executionId);
    if (!socket) return null;

    const raw = await this.withTimeout(
      this.emitOnce(socket, {
        protocol: PORTAL_FILL_PROTOCOL_VERSION,
        kind: 'probe',
        executionId,
        selectors,
        ...(ops ? { ops } : {}),
      }),
      PROBE_TIMEOUT_MS,
    );

    if (!raw || typeof raw !== 'object') return null;
    const reply = raw as {
      protocol?: number;
      executionId?: string;
      results?: unknown;
      page?: unknown;
    };
    if (
      typeof reply.protocol !== 'number' ||
      !isPortalFillProtocolCompatible(reply.protocol)
    ) {
      return null;
    }
    if (reply.executionId !== executionId) return null;
    if (!Array.isArray(reply.results)) return null;

    const out: SelectorProbe[] = [];
    for (const r of reply.results as Array<Record<string, unknown>>) {
      if (typeof r?.selector !== 'string' || typeof r?.found !== 'boolean') {
        return null; // a malformed row makes the whole answer untrustworthy
      }
      out.push({ selector: r.selector, found: r.found });
    }
    // Every selector asked about must be answered, or we know nothing.
    if (out.length !== selectors.length) return null;
    const page =
      typeof reply.page === 'string' && reply.page.startsWith('/')
        ? reply.page.slice(0, 200)
        : null;
    return { results: out, page };
  }

  async send(intent: SignedWriteIntent): Promise<FieldExecResult> {
    const socket = this.bound.get(intent.executionId);
    if (!socket) {
      // Fail closed: no live channel for THIS execution. Never fall back to
      // another socket, and never treat an unbound run as a success.
      return this.fail(intent, 'transport_error');
    }

    // Downgrade to the least-authority wire shape. `sig` / `lockedDiffHash` /
    // `category` are deliberately not included.
    const command: PortalFillWriteCommand = {
      protocol: PORTAL_FILL_PROTOCOL_VERSION,
      kind: 'write',
      executionId: intent.executionId,
      fieldKey: intent.fieldKey,
      selector: intent.selector,
      mappedValue: intent.mappedValue,
      expectedValueHash: intent.expectedValueHash,
      ...(intent.op ? { op: intent.op } : {}),
      ...(intent.reveal ? { reveal: true } : {}),
      ...(intent.dialog ? { dialog: true } : {}),
    };

    const raw = await this.emitOnce(socket, command);
    return this.normalize(intent, raw);
  }

  /**
   * One emit, one ack. Resolves with the raw ack payload, or null if the ack is
   * never delivered. The caller (ExtensionBridgeExecutor) races this against its
   * own hard timeout, so this promise intentionally has no timer of its own —
   * two competing timeouts would race to classify the same failure.
   */
  private emitOnce(
    socket: ExtensionSocket,
    command: PortalFillWriteCommand | Record<string, unknown>,
  ): Promise<unknown> {
    return new Promise<unknown>((resolve) => {
      let settled = false;
      try {
        const event =
          (command as { kind?: string }).kind === 'probe'
            ? PORTAL_FILL_PROBE_EVENT
            : PORTAL_FILL_WRITE_EVENT;
        socket.emit(event, command, (raw: unknown) => {
          if (settled) return; // a duplicate ack must not re-resolve
          settled = true;
          resolve(raw);
        });
      } catch (err) {
        // A dead socket can throw synchronously on emit.
        this.log.warn(
          `portal-fill emit failed for ${String((command as { executionId?: string }).executionId)}: ${
            err instanceof Error ? err.message : 'unknown'
          }`,
        );
        if (!settled) {
          settled = true;
          resolve(null);
        }
      }
    });
  }

  /**
   * Accept a reply only if it is a protocol-compatible field_result bound to the
   * intent we actually sent. Anything else is a transport error — we never guess
   * which field a malformed reply belongs to.
   */
  private normalize(intent: SignedWriteIntent, raw: unknown): FieldExecResult {
    if (!raw || typeof raw !== 'object')
      return this.fail(intent, 'transport_error');

    const reply = raw as Partial<PortalFillFieldResult>;

    if (
      typeof reply.protocol !== 'number' ||
      !isPortalFillProtocolCompatible(reply.protocol)
    ) {
      return this.fail(intent, 'dom_change');
    }
    if (reply.kind !== 'field_result')
      return this.fail(intent, 'transport_error');
    if (reply.executionId !== intent.executionId)
      return this.fail(intent, 'transport_error');
    if (reply.fieldKey !== intent.fieldKey)
      return this.fail(intent, 'transport_error');
    if (reply.outcome !== 'verified' && reply.outcome !== 'failed') {
      return this.fail(intent, 'transport_error');
    }

    return {
      fieldKey: intent.fieldKey,
      outcome: reply.outcome,
      reason: reply.reason,
      actualValueHash: reply.actualValueHash,
      selectorFound: reply.selectorFound === true,
    };
  }

  /** Resolve null rather than hanging if the ack never arrives. */
  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
  }

  private fail(
    intent: SignedWriteIntent,
    reason: FieldExecResult['reason'],
  ): FieldExecResult {
    return {
      fieldKey: intent.fieldKey,
      outcome: 'failed',
      reason,
      selectorFound: false,
    };
  }
}
