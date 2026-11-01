import { Inject, Injectable } from '@nestjs/common';
import type {
  ActorRef,
  AuditEventType,
  OrchestrationResult,
  SignedWriteIntent,
  ValueHash,
} from '@visaai/types';
import { AuditService } from '../audit/audit.service';
import { FIELD_EXECUTOR } from './field-executor.port';
import type { IFieldExecutor } from './field-executor.port';

/**
 * PortalFillOrchestrator (Phase 7G) — strict single-cursor execution loop.
 *
 * Drives the per-field execute→readback→verify loop (state machine per
 * phase-7g-orchestration-design.md), with the field executor INJECTED via a port.
 * Emits audit events through the single AuditService writer.
 *
 * Guarantees:
 *  - Single cursor: one field at a time, strictly sequential.
 *  - First-mismatch halt: the first failed field stops the loop; no later field
 *    is attempted; HALTED → EXECUTION_FAILED; terminal.
 *  - Does NOT emit EXECUTION_STARTED (that authority belongs to ExecutionService).
 *  - No form-completion / page-advance / payment path exists in this class.
 *  - Fails closed: an executor throw halts the run (EXECUTION_FAILED).
 *
 * It is NOT wired to a live execution path; a caller (after EXECUTION_STARTED)
 * passes the executionId + signed intents. The concrete executor port is a
 * placeholder until the extension round-trip ships.
 */
/** Upper bound on "look again" rounds in one run (a progressive page). */
export const MAX_REVEAL_ROUNDS = 25;

@Injectable()
export class PortalFillOrchestrator {
  constructor(
    @Inject(FIELD_EXECUTOR) private readonly executor: IFieldExecutor,
    private readonly audit: AuditService,
  ) {}

  async run(
    applicationId: string,
    executionId: string,
    intents: SignedWriteIntent[],
    actor: ActorRef,
    /**
     * A progressive page (one path, questions revealed as earlier ones are
     * answered): asked, once the queued intents are verified, for signed
     * intents whose targets have appeared since. They run in the same
     * single-cursor loop under the same first-mismatch halt. An empty answer
     * — or a lookup that fails — ends the run; it never makes it fail.
     */
    more?: () => Promise<SignedWriteIntent[]>,
  ): Promise<OrchestrationResult> {
    await this.emit(applicationId, executionId, 'PORTAL_FILL_STARTED', actor);

    const verified: string[] = [];
    let queue = intents;

    for (let round = 0; queue.length > 0; round++) {
      for (const intent of queue) {
        // EXECUTING
        await this.emit(
          applicationId,
          executionId,
          'FIELD_WRITE_ATTEMPT',
          actor,
          intent.fieldKey,
          undefined,
          intent.selector,
        );

        let res;
        try {
          res = await this.executor.executeField(intent);
        } catch {
          // Infrastructure failure — fail closed.
          return this.fail(
            applicationId,
            executionId,
            actor,
            intent.fieldKey,
            undefined,
            verified,
          );
        }

        // VERIFYING
        await this.emit(
          applicationId,
          executionId,
          'READBACK_COMPARE',
          actor,
          intent.fieldKey,
          res.actualValueHash,
          intent.selector,
        );

        if (res.outcome === 'failed') {
          return this.fail(
            applicationId,
            executionId,
            actor,
            intent.fieldKey,
            res.reason,
            verified,
          );
        }

        await this.emit(
          applicationId,
          executionId,
          'FIELD_VERIFIED',
          actor,
          intent.fieldKey,
          res.actualValueHash,
          intent.selector,
        );
        verified.push(intent.fieldKey);
      }
      queue = [];
      if (more && round < MAX_REVEAL_ROUNDS) {
        try {
          queue = await more();
        } catch {
          queue = [];
        }
      }
    }

    await this.emit(applicationId, executionId, 'PORTAL_FILL_COMPLETED', actor);
    await this.audit.append({
      applicationId,
      eventType: 'EXECUTION_COMPLETED',
      actor,
      refs: { submissionSessionId: executionId },
      payload: { executionId, verified_count: verified.length },
    });

    return { executionId, state: 'COMPLETED', verified };
  }

  private async fail(
    applicationId: string,
    executionId: string,
    actor: ActorRef,
    failedField: string,
    haltReason: OrchestrationResult['haltReason'],
    verified: string[],
  ): Promise<OrchestrationResult> {
    await this.audit.append({
      applicationId,
      eventType: 'EXECUTION_FAILED',
      actor,
      refs: { fieldKey: failedField, submissionSessionId: executionId },
      payload: {
        executionId,
        reason: haltReason ?? 'executor_error',
        stage: 'portal_fill',
      },
    });
    return { executionId, state: 'FAILED', verified, failedField, haltReason };
  }

  private emit(
    applicationId: string,
    executionId: string,
    eventType: AuditEventType,
    actor: ActorRef,
    fieldKey?: string,
    valueHash?: ValueHash,
    target?: string,
  ) {
    return this.audit.append({
      applicationId,
      eventType,
      actor,
      valueHash: valueHash ?? null,
      refs: { fieldKey: fieldKey ?? null, submissionSessionId: executionId },
      // Keyed per target: the same field written to several controls would
      // otherwise dedupe to one audit row and hide the other writes.
      idempotencyKey: `${eventType}:${executionId}:${fieldKey ?? '_'}${target ? `:${target}` : ''}`,
      payload: target ? { executionId, target } : { executionId },
    });
  }
}
