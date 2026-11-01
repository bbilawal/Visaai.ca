import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type {
  ExecutionFailReason,
  ExecutionResult,
  ReadbackTokenPayload,
} from '@visaai/types';
import { AuditService } from '../audit/audit.service';
import { PreflightService } from '../preflight/preflight.service';
import { ConsultantApprovalService } from '../consultant/consultant-approval.service';
import { VerificationService } from '../verification/verification.service';
import { ExecutionEligibilityService } from '../eligibility/execution-eligibility.service';
import { ReadbackTokenService } from './readback-token.service';
import { EXECUTION_TOKEN_STORE } from './execution-token.store';
import type { IExecutionTokenStore } from './execution-token.store';
import { AuditAnalyticsAdapter } from '../analytics/adapters/audit-analytics.adapter';

/**
 * ExecutionService — the SINGLE, server-authoritative execution choke point.
 *
 * execute() performs FULL, LIVE, read-only revalidation before authorizing
 * execution. EXECUTION_STARTED is emitted here and NOWHERE else, exactly once,
 * only after every check passes. Any state change since the readback token was
 * issued blocks execution with a structured reason (EXECUTION_FAILED).
 *
 * No mutations occur before EXECUTION_STARTED: all checks are read-only, and the
 * eligibility re-evaluation is idempotent on session+preflight (its
 * EXECUTION_READY was already emitted at readback-confirm), so it appends nothing
 * new here.
 */
@Injectable()
export class ExecutionService {
  constructor(
    private readonly readbackTokens: ReadbackTokenService,
    private readonly preflight: PreflightService,
    private readonly consultant: ConsultantApprovalService,
    private readonly verification: VerificationService,
    private readonly eligibility: ExecutionEligibilityService,
    private readonly audit: AuditService,
    @Inject(EXECUTION_TOKEN_STORE)
    private readonly tokenStore: IExecutionTokenStore,
    @Optional() private readonly auditAnalytics?: AuditAnalyticsAdapter,
  ) {}

  async execute(
    applicationId: string,
    readbackToken: string,
  ): Promise<ExecutionResult> {
    const payload = this.readbackTokens.verify(readbackToken);
    if (!payload || payload.applicationId !== applicationId) {
      return this.fail(applicationId, ['readback_stale']);
    }

    const reasons = new Set<ExecutionFailReason>();

    // B. readback binding — current lock must equal the token-bound lock.
    const review = await this.preflight.getReview(payload.preflightReviewId);
    if (
      !review ||
      review.status !== 'completed' ||
      review.locked_diff_hash !== payload.lockedDiffHash
    ) {
      reasons.add('lock_changed');
    }

    // 1. preflight lock revalidation (recompute diff vs locked hash).
    const lock = await this.preflight.validateLock(
      payload.preflightReviewId,
      payload.mappings,
      applicationId,
    );
    if (!lock.valid) {
      for (const r of lock.reasons) {
        if (r === 'verification_drift') reasons.add('verification_drift');
        else if (r === 'stale_approval')
          reasons.add('consultant_state_changed');
        else reasons.add('lock_changed'); // provenance/mapping change, reassigned, no active, not_completed, invalidated
      }
    }

    // 2. consultant approval still valid (no stale / revoked / rejected / missing).
    const rollup = await this.consultant.getApplicationApproval(applicationId);
    const consultantBroken =
      !rollup.applicationApproved ||
      rollup.fields.some(
        (f) => f.stale || f.decision === 'revoked' || f.decision === 'rejected',
      );
    if (consultantBroken) reasons.add('consultant_state_changed');

    // 3. verification drift.
    const readiness =
      await this.verification.evaluateExecutionReadiness(applicationId);
    if (!readiness.noDrift) reasons.add('verification_drift');

    // 4 + 5. live eligibility (recomputed, never cached) — includes token validity.
    try {
      const elig = await this.eligibility.evaluate({
        applicationId,
        preflightReviewId: payload.preflightReviewId,
        mappings: payload.mappings,
        token: payload.executionToken,
        sessionId: payload.sessionId,
        userId: payload.userId,
      });
      if (!elig.eligible) reasons.add('eligibility_recomputed_false');
    } catch {
      // token validator (or any predicate source) failing => fail closed.
      reasons.add('eligibility_recomputed_false');
    }

    if (reasons.size > 0)
      return this.fail(applicationId, [...reasons], payload);

    // Atomic single-use commit (replay protection). First use wins; any second
    // use of the same token collides and is rejected — TOCTOU-safe via PK.
    const firstUse = await this.tokenStore.consume(
      this.hash(readbackToken),
      applicationId,
    );
    if (!firstUse)
      return this.fail(applicationId, ['replay_detected'], payload);

    // ALL checks passed AND token consumed — the one and only EXECUTION_STARTED.
    await this.audit.append({
      applicationId,
      eventType: 'EXECUTION_STARTED',
      actor: { id: payload.userId, role: 'applicant' },
      refs: { submissionSessionId: payload.sessionId },
      payload: {
        preflight_id: payload.preflightReviewId,
        locked_diff_hash: payload.lockedDiffHash,
      },
    });
    // Analytics mirror (non-invasive, does not touch the hash-chain above).
    this.auditAnalytics?.mirror(applicationId, 'EXECUTION_STARTED');

    return { started: true, reasons: [] };
  }

  private async fail(
    applicationId: string,
    reasons: ExecutionFailReason[],
    payload?: ReadbackTokenPayload,
  ): Promise<ExecutionResult> {
    await this.audit.append({
      applicationId,
      eventType: 'EXECUTION_FAILED',
      actor: { id: payload?.userId ?? null, role: 'system' },
      refs: { submissionSessionId: payload?.sessionId ?? null },
      payload: { reasons, preflight_id: payload?.preflightReviewId ?? null },
    });
    return { started: false, reasons };
  }

  private hash(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}
