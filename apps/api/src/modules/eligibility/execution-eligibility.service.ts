import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type {
  EligibilityCheckInput,
  EligibilityConditions,
  EligibilityReason,
  EligibilityResult,
} from '@visaai/types';
import { AuditService } from '../audit/audit.service';
import { ConsultantApprovalService } from '../consultant/consultant-approval.service';
import { PreflightService } from '../preflight/preflight.service';
import { PAYMENT_READ_MODEL, TOKEN_VALIDATOR } from './eligibility.repository';
import type {
  IPaymentReadModel,
  ITokenValidator,
} from './eligibility.repository';

/**
 * ExecutionEligibilityService — the FINAL compliance gate.
 *
 * Evaluates four independent predicates:
 *   payment_completed AND consultant_approval_valid AND preflight_lock_valid
 *   AND execution_token_valid
 *
 * READ-ONLY orchestration: mints no tokens, mutates no approvals/state, starts
 * no execution. The single declared effect is emitting EXECUTION_READY (audit)
 * when — and only when — all four predicates pass (idempotent per session+lock).
 * It calls PreflightService.validateLock() so a stale/invalid trust anchor
 * blocks eligibility. Actual execution lives outside this service.
 */
@Injectable()
export class ExecutionEligibilityService {
  constructor(
    @Inject(PAYMENT_READ_MODEL) private readonly payment: IPaymentReadModel,
    @Inject(TOKEN_VALIDATOR) private readonly token: ITokenValidator,
    private readonly consultant: ConsultantApprovalService,
    private readonly preflight: PreflightService,
    private readonly audit: AuditService,
  ) {}

  async evaluate(input: EligibilityCheckInput): Promise<EligibilityResult> {
    const reasons = new Set<EligibilityReason>();

    // 1. payment_completed
    const paymentCompleted = await this.payment.hasPaidPrefill(
      input.applicationId,
    );
    if (!paymentCompleted) reasons.add('payment_missing');

    // 2. consultant_approval_valid
    const assignment = await this.consultant.getAssignment(input.applicationId);
    const rollup = await this.consultant.getApplicationApproval(
      input.applicationId,
    );
    const anyStale = rollup.fields.some((f) => f.stale);
    let consultantApprovalValid = false;
    if (!assignment) reasons.add('consultant_missing');
    else if (anyStale) reasons.add('consultant_stale');
    else if (!rollup.applicationApproved) reasons.add('consultant_missing');
    else consultantApprovalValid = true;

    // 3. preflight_lock_valid — MUST validate the trust anchor (B).
    let preflightLockValid = false;
    try {
      const lock = await this.preflight.validateLock(
        input.preflightReviewId,
        input.mappings,
        input.applicationId,
      );
      preflightLockValid = lock.valid;
      if (!lock.valid) {
        for (const r of lock.reasons) {
          if (r === 'not_completed' || r === 'already_invalidated')
            reasons.add('preflight_incomplete');
          else if (r === 'verification_drift')
            reasons.add('verification_drift');
          else if (r === 'stale_approval') reasons.add('consultant_stale');
          else reasons.add('preflight_invalid'); // provenance/mapping change, reassigned, no active consultant
        }
      }
    } catch {
      // review missing / not found -> treat as incomplete
      reasons.add('preflight_incomplete');
    }

    // 4. execution_token_valid (validated via port; never minted here)
    const executionTokenValid = await this.token.isValid(
      input.token,
      input.sessionId,
      input.applicationId,
      input.userId,
    );
    if (!executionTokenValid) reasons.add('token_invalid');

    const conditions: EligibilityConditions = {
      paymentCompleted,
      consultantApprovalValid,
      preflightLockValid,
      executionTokenValid,
    };
    const eligible = reasons.size === 0;

    // E. Emit EXECUTION_READY only when eligible (the one declared effect).
    // Idempotent on session+lock so repeated checks do not spam the chain.
    if (eligible) {
      await this.audit.append({
        applicationId: input.applicationId,
        eventType: 'EXECUTION_READY',
        actor: { id: null, role: 'system' },
        refs: { submissionSessionId: input.sessionId },
        idempotencyKey: `exec-ready:${input.sessionId}:${input.preflightReviewId}`,
        payload: { preflight_id: input.preflightReviewId, conditions },
      });
    }

    return {
      applicationId: input.applicationId,
      eligible,
      conditions,
      reasons: [...reasons],
    };
  }

  /** Throws ExecutionNotEligible (with reasons) when not eligible. */
  async assert(input: EligibilityCheckInput): Promise<void> {
    const result = await this.evaluate(input);
    if (!result.eligible) {
      throw new ForbiddenException(
        `execution not eligible: ${result.reasons.join(', ')}`,
      );
    }
  }

  /** Read-only token-validity check via the port (no minting). */
  async isTokenValid(
    token: string,
    sessionId: string,
    applicationId: string,
    userId: string,
  ): Promise<boolean> {
    return this.token.isValid(token, sessionId, applicationId, userId);
  }
}
