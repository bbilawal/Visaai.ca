import { Injectable } from '@nestjs/common';
import type {
  ExecutionRequestDecision,
  ExecutionRequestInput,
} from '@visaai/types';
import { AuditService } from '../audit/audit.service';
import { ExecutionEligibilityService } from '../eligibility/execution-eligibility.service';
import { PreflightService } from '../preflight/preflight.service';
import { ReadbackTokenService } from '../execution/readback-token.service';

/**
 * ExecutionRequestService — Phase 3F server-authoritative gate.
 *
 * Receives an execution REQUEST (never a command). Enforces, server-side:
 *   1. mandatory readback confirmation (userConfirmationFlag)
 *   2. full eligibility revalidation via ExecutionEligibilityService.evaluate,
 *      which re-runs PreflightService.validateLock (recompute diff vs
 *      locked_diff_hash) + consultant-staleness + verification drift + token.
 *
 * On pass: emits READBACK_CONFIRMED + EXECUTION_REQUESTED and returns
 * allowed=true. It does NOT mint tokens, create/mutate sessions, start
 * execution, or touch browser automation. EXECUTION_STARTED is never emitted
 * here. On any failure it returns reasons only — no audit-request events.
 */
@Injectable()
export class ExecutionRequestService {
  constructor(
    private readonly eligibility: ExecutionEligibilityService,
    private readonly audit: AuditService,
    private readonly preflight: PreflightService,
    private readonly readbackTokens: ReadbackTokenService,
  ) {}

  async request(
    input: ExecutionRequestInput,
  ): Promise<ExecutionRequestDecision> {
    // 1. Readback gate — the UI's only contribution.
    if (!input.userConfirmationFlag) {
      return {
        allowed: false,
        blockedReasons: ['readback_not_confirmed'],
        evaluationDetails: null,
      };
    }

    // 2. Full server-side revalidation (read-only; emits EXECUTION_READY if eligible).
    const result = await this.eligibility.evaluate(input);
    if (!result.eligible) {
      return {
        allowed: false,
        blockedReasons: result.reasons,
        evaluationDetails: result.conditions,
      };
    }

    const refs = { submissionSessionId: input.sessionId };
    const basePayload = {
      preflight_id: input.preflightReviewId,
      conditions: result.conditions,
    };

    await this.audit.append({
      applicationId: input.applicationId,
      eventType: 'READBACK_CONFIRMED',
      actor: { id: input.userId, role: 'applicant' },
      refs,
      idempotencyKey: `readback:${input.sessionId}:${input.preflightReviewId}`,
      payload: basePayload,
    });

    await this.audit.append({
      applicationId: input.applicationId,
      eventType: 'EXECUTION_REQUESTED',
      actor: { id: input.userId, role: 'applicant' },
      refs,
      idempotencyKey: `exec-requested:${input.sessionId}:${input.preflightReviewId}`,
      payload: basePayload,
    });

    // Mint the readback token bound to the CURRENT lock. The execution choke
    // point will reject it if anything changes before execute().
    const review = await this.preflight.getReview(input.preflightReviewId);
    const readbackToken = review?.locked_diff_hash
      ? this.readbackTokens.mint({
          applicationId: input.applicationId,
          preflightReviewId: input.preflightReviewId,
          sessionId: input.sessionId,
          userId: input.userId,
          executionToken: input.token,
          lockedDiffHash: review.locked_diff_hash,
          mappings: input.mappings,
        })
      : undefined;

    return {
      allowed: true,
      blockedReasons: [],
      evaluationDetails: result.conditions,
      readbackToken,
    };
  }
}
