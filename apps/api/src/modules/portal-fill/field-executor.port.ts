import { Inject, Injectable, Optional } from '@nestjs/common';
import type { FieldExecResult, SignedWriteIntent } from '@visaai/types';

/**
 * The orchestrator's injected field executor (the "engine" port). Executes ONE
 * signed write intent and returns its verified/failed result. The orchestrator
 * depends only on this interface, so it stays server-side + testable.
 */
export interface IFieldExecutor {
  executeField(intent: SignedWriteIntent): Promise<FieldExecResult>;
}

export const FIELD_EXECUTOR = Symbol('IFieldExecutor');

/**
 * Transport that carries a signed intent to the extension content script and
 * returns its field result. Concrete socket adapter is the live connector; tests
 * inject a fake. Default binding is DisconnectedTransport (fail-closed).
 */
export interface IExtensionTransport {
  send(intent: SignedWriteIntent): Promise<FieldExecResult>;
}

export const EXTENSION_TRANSPORT = Symbol('IExtensionTransport');

const DEFAULT_TIMEOUT_MS = 15_000;

/** Distinguishes a timeout from other transport errors (no string matching). */
class TimeoutError extends Error {
  constructor() {
    super('execute timeout');
    this.name = 'TimeoutError';
  }
}

/**
 * Phase 7H — the ONLY field executor implementation. Deterministic + fail-closed.
 *  - replay (executionId:fieldKey:selector) -> returns immediately, NEVER calls transport
 *  - transport.send raced against a hard timeout -> reason 'timeout'
 *  - any other thrown error -> reason 'transport_error' (never propagated)
 *  - result ALWAYS normalized (no blind passthrough)
 *  - NO DOM access, NO submit, NO retry (single attempt)
 *
 * Works in DI mode (new(@Inject transport)) and test mode (new(transport, ms)).
 */
@Injectable()
export class ExtensionBridgeExecutor implements IFieldExecutor {
  private readonly consumed: Set<string> = new Set<string>();
  private readonly timeoutMs: number;

  constructor(
    @Inject(EXTENSION_TRANSPORT)
    private readonly transport: IExtensionTransport,
    @Optional() timeoutMs?: number,
  ) {
    this.timeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async executeField(intent: SignedWriteIntent): Promise<FieldExecResult> {
    // Per target, not per field: one value can feed several controls (a date →
    // year / month / day), and each control is written exactly once per run.
    const key = `${intent.executionId}:${intent.fieldKey}:${intent.selector}`;
    if (this.consumed.has(key)) {
      return {
        fieldKey: intent.fieldKey,
        outcome: 'failed',
        reason: 'replay',
        selectorFound: false,
      };
    }
    this.consumed.add(key);

    let raw: FieldExecResult;
    try {
      raw = await this.race(this.transport.send(intent), this.timeoutMs);
    } catch (err) {
      return {
        fieldKey: intent.fieldKey,
        outcome: 'failed',
        reason: err instanceof TimeoutError ? 'timeout' : 'transport_error',
        selectorFound: false,
      };
    }

    return this.verifyResult(intent, raw);
  }

  /**
   * Enforce the FieldExecResult schema AND independently confirm a reported
   * success: the extension's actualValueHash MUST equal the intent's expected
   * hash. A 'verified' reply without the matching hash (compromised/buggy
   * extension) is downgraded to a value_mismatch failure — the server never
   * trusts the outcome flag alone.
   */
  private verifyResult(
    intent: SignedWriteIntent,
    raw: FieldExecResult,
  ): FieldExecResult {
    const fieldKey = intent.fieldKey;
    if (
      raw?.outcome === 'verified' &&
      raw.actualValueHash === intent.expectedValueHash
    ) {
      return {
        fieldKey,
        outcome: 'verified',
        actualValueHash: raw.actualValueHash,
        selectorFound: true,
      };
    }
    if (raw?.outcome === 'verified') {
      // reported success but hash does not match expected -> not trusted
      return {
        fieldKey,
        outcome: 'failed',
        reason: 'value_mismatch',
        actualValueHash: raw.actualValueHash,
        selectorFound: true,
      };
    }
    return {
      fieldKey,
      outcome: 'failed',
      reason: raw?.reason ?? 'transport_error',
      actualValueHash: raw?.actualValueHash,
      selectorFound: raw?.selectorFound === true,
    };
  }

  private race<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<T>((_resolve, reject) => {
      timer = setTimeout(() => reject(new TimeoutError()), ms);
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
  }
}

/**
 * Default transport: disconnected. No live channel -> returns a fail-closed
 * result (NEVER throws). Replaced by the concrete socket adapter when the
 * extension round-trip is wired.
 */
@Injectable()
export class DisconnectedTransport implements IExtensionTransport {
  async send(intent: SignedWriteIntent): Promise<FieldExecResult> {
    return {
      fieldKey: intent.fieldKey,
      outcome: 'failed',
      reason: 'transport_error',
      selectorFound: false,
    };
  }
}
