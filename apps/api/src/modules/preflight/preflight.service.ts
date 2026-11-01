import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type {
  ActorRef,
  PreflightCheckKey,
  PreflightDiffEntry,
  PreflightDiffSet,
  PreflightInvalidationReason,
  PreflightLockValidation,
  PreflightMappingInput,
  PreflightReview,
} from '@visaai/types';
import { AuditService } from '../audit/audit.service';
import { ProvenanceService } from '../provenance/provenance.service';
import { VerificationService } from '../verification/verification.service';
import { ConsultantApprovalService } from '../consultant/consultant-approval.service';
import { PREFLIGHT_REPOSITORY } from './preflight.repository';
import type { IPreflightRepository } from './preflight.repository';
import { PreflightMappingService } from './preflight-mapping.service';

const CHECK_KEYS: PreflightCheckKey[] = [
  'passport_reviewed',
  'dates_reviewed',
  'travel_history_reviewed',
  'addresses_reviewed',
  'employment_reviewed',
  'final_approval',
];

/**
 * PreflightService — execution safety gate.
 *
 * Assembles an immutable diff set (source_value_hash | target_field |
 * mapped_value_hash — hashes only), creates the preflight snapshot/lock hash
 * (the future EXECUTION TRUST ANCHOR), validates the six mandatory checks, and
 * gates completion on no-stale-approvals + no-drift + active-consultant. Lock
 * validation re-derives the anchor and reports every invalidation reason.
 *
 * NOT wired into extension/execution (frozen). Mappings are supplied by the
 * caller (prefill source wired later); execution validation against the anchor
 * is a later phase.
 */
@Injectable()
export class PreflightService {
  constructor(
    @Inject(PREFLIGHT_REPOSITORY) private readonly repo: IPreflightRepository,
    private readonly provenance: ProvenanceService,
    private readonly verification: VerificationService,
    private readonly consultant: ConsultantApprovalService,
    private readonly audit: AuditService,
    private readonly mappings: PreflightMappingService,
  ) {}

  /**
   * Who may open, tick and lock a review: the ACTIVE assignee (primary or
   * backup) or an admin. Before this an applicant could call start on their
   * own application — and since start retires the live lock, that was a way
   * to knock out the consultant's lock at will.
   */
  private async assertReviewer(
    applicationId: string,
    actor: ActorRef,
  ): Promise<void> {
    if (actor.role === 'admin') return;
    if (actor.role !== 'consultant' || !actor.id) {
      throw new ForbiddenException(
        'Only the assigned consultant can run the pre-submission review',
      );
    }
    await this.consultant.assertAssigned(applicationId, actor.id);
  }

  // ---- F. start (audit PREFLIGHT_STARTED) ------------------------------
  async start(
    applicationId: string,
    reviewer: ActorRef,
    submissionSessionId?: string,
  ): Promise<PreflightReview> {
    await this.assertReviewer(applicationId, reviewer);
    // One live lock at a time. Re-reviewing (after a value changed, or to edit
    // a locked field) retires the previous lock so an execution request can
    // never be authorized against a review that has been superseded.
    const previous = await this.repo.getActive(applicationId);
    if (previous?.status === 'in_review') {
      throw new ConflictException(
        'A review is already in progress for this application. Reload to continue it.',
      );
    }
    const superseded = previous?.status === 'completed' ? previous.id : null;
    if (superseded) await this.repo.markInvalidated(superseded);

    const review = await this.repo.insert(
      applicationId,
      reviewer,
      submissionSessionId ?? null,
    );
    await this.audit.append({
      applicationId,
      eventType: 'PREFLIGHT_STARTED',
      actor: reviewer,
      refs: { submissionSessionId: submissionSessionId ?? null },
      payload: {
        preflight_id: review.id,
        ...(superseded ? { superseded_preflight_id: superseded } : {}),
      },
    });
    return review;
  }

  // ---- A. diff assembly (immutable; hashes only) -----------------------
  async assembleDiff(
    applicationId: string,
    mappings: PreflightMappingInput[],
  ): Promise<PreflightDiffSet> {
    const entries: PreflightDiffEntry[] = [];
    for (const m of mappings) {
      const current = await this.provenance.getCurrentFieldVersion(
        applicationId,
        m.fieldKey,
      );
      entries.push({
        fieldKey: m.fieldKey,
        targetField: m.targetField,
        category: m.category,
        // Only when set, so locks over page-less mappings keep their hash.
        ...(m.page ? { page: m.page } : {}),
        // How the target is operated is part of what was reviewed: the same
        // selector clicked as a radio or typed into is a different write.
        ...(m.op ? { op: m.op } : {}),
        ...(m.reveal ? { reveal: true } : {}),
        ...(m.dialog ? { dialog: true } : {}),
        sourceValueHash: current?.value_hash ?? null,
        mappedValueHash:
          m.mappedValue == null
            ? null
            : this.provenance.valueHash(m.mappedValue),
      });
    }
    // One value can feed several targets (a date → year/month/day selects), so
    // order by target too: the hash must not depend on mapping order.
    entries.sort((a, b) =>
      a.fieldKey !== b.fieldKey
        ? a.fieldKey < b.fieldKey
          ? -1
          : 1
        : a.targetField < b.targetField
          ? -1
          : a.targetField > b.targetField
            ? 1
            : 0,
    );
    return { applicationId, entries, diffHash: this.computeDiffHash(entries) };
  }

  computeDiffHash(entries: PreflightDiffEntry[]): string {
    return this.audit.payloadHash({ entries });
  }

  // ---- B. snapshot/lock hash (the execution trust anchor) --------------
  private computeSnapshotHash(
    diffHash: string,
    applicationId: string,
    consultantId: string | null,
    completedAt: string,
  ): string {
    return this.audit.payloadHash({
      diffHash,
      applicationId,
      consultantId,
      // Canonical instant, not the string as stored: complete() hashes the JS
      // ISO form ("…24.900Z") but PostgREST returns timestamptz as
      // "…24.9+00:00", and every re-derivation in validateLock failed.
      completedAt: completedAt
        ? new Date(completedAt).toISOString()
        : completedAt,
    });
  }

  // ---- C. six-check validation -----------------------------------------
  /**
   * Bind a `:reviewId` to the `:applicationId` it was addressed under.
   *
   * The route is `/applications/:applicationId/preflight/reviews/:reviewId/...`
   * and the guard authorizes the APPLICATION. Without this check a caller who
   * legitimately owns application A could pass their own id in the path and a
   * review id belonging to application B, and every repository method — all of
   * which run on the RLS-bypassing service-role client keyed on the review id
   * alone — would happily act on the victim's review.
   *
   * Fails closed: unknown review, or a review from a different application, is
   * a refusal.
   */
  private async assertReviewBelongsTo(
    reviewId: string,
    applicationId: string,
  ): Promise<PreflightReview> {
    const review = await this.repo.getById(reviewId);
    if (!review) {
      throw new NotFoundException(`preflight not found: ${reviewId}`);
    }
    if (review.application_id !== applicationId) {
      // Deliberately the same shape as "not found": telling a caller that a
      // review exists but belongs elsewhere confirms the id for them.
      throw new NotFoundException(`preflight not found: ${reviewId}`);
    }
    return review;
  }

  async recordCheck(
    reviewId: string,
    check: PreflightCheckKey,
    value: boolean,
    applicationId: string,
    actor: ActorRef,
  ): Promise<PreflightReview> {
    await this.assertReviewer(applicationId, actor);
    await this.assertReviewBelongsTo(reviewId, applicationId);
    return this.repo.setCheck(reviewId, check, value);
  }

  /**
   * A reviewed value changed: un-tick the categories that covered it plus the
   * final approval, so the consultant must look again before locking. Only an
   * in-review review can be reset (the repository refuses anything else).
   */
  async resetChecks(
    reviewId: string,
    checks: PreflightCheckKey[],
  ): Promise<PreflightReview> {
    let row: PreflightReview | null = null;
    for (const c of new Set<PreflightCheckKey>([...checks, 'final_approval']))
      row = await this.repo.setCheck(reviewId, c, false);
    return row as PreflightReview;
  }

  private allChecksPass(row: PreflightReview): boolean {
    return CHECK_KEYS.every((k) => row[k] === true);
  }

  // ---- D. completion ---------------------------------------------------
  async complete(
    reviewId: string,
    mappings: PreflightMappingInput[],
    actor: ActorRef,
    applicationId: string,
  ): Promise<PreflightReview> {
    await this.assertReviewer(applicationId, actor);
    const review = await this.assertReviewBelongsTo(reviewId, applicationId);
    if (review.status !== 'in_review') {
      throw new BadRequestException(
        `preflight ${reviewId} is not in_review (${review.status})`,
      );
    }

    const appId = review.application_id;

    if (!this.allChecksPass(review)) {
      throw new BadRequestException(
        'preflight cannot complete: all six checks must pass',
      );
    }

    const active = await this.consultant.getAssignment(appId);
    if (!active)
      throw new BadRequestException(
        'preflight cannot complete: no active consultant assignment',
      );

    // The lock is the assigned consultant's attestation, and validateLock
    // requires reviewer_id === the active assignee. Bind it to whoever locks
    // it when that is the assignee (an admin may have opened the review);
    // otherwise the lock would be broken on arrival (consultant_reassigned),
    // so refuse it instead of writing it.
    const lockedBy: ActorRef | null =
      actor.role === 'consultant' && actor.id === active.consultant_id
        ? actor
        : review.reviewer_id === active.consultant_id
          ? { id: review.reviewer_id, role: 'consultant' }
          : null;
    if (!lockedBy) {
      throw new ConflictException(
        'Only the assigned consultant can lock this review. Ask them to complete it.',
      );
    }

    const rollup = await this.consultant.getApplicationApproval(appId);
    if (rollup.fields.some((f) => f.stale)) {
      throw new BadRequestException(
        'preflight cannot complete: stale consultant approval present',
      );
    }

    const readiness = await this.verification.evaluateExecutionReadiness(appId);
    if (!readiness.noDrift) {
      throw new BadRequestException(
        'preflight cannot complete: verification drift present',
      );
    }

    // Lock what the SERVER derives now, not what the client is holding: the
    // applicant may have saved the form since the consultant's page loaded.
    // Locking the stale copy would produce a lock that is broken on arrival —
    // or, worse, look like a review of values nobody saw.
    const diff = await this.assembleDiff(appId, mappings);
    const current = await this.assembleDiff(
      appId,
      await this.mappings.forApplication(appId),
    );
    if (current.diffHash !== diff.diffHash) {
      throw new ConflictException(
        'The values changed since you reviewed them. Refresh, re-check the changed fields, then lock.',
      );
    }
    const completedAt = new Date().toISOString();
    const snapshotHash = this.computeSnapshotHash(
      diff.diffHash,
      appId,
      lockedBy.id,
      completedAt,
    );

    const completed = await this.repo.markCompleted(
      reviewId,
      snapshotHash,
      completedAt,
      lockedBy,
    );

    await this.audit.append({
      applicationId: appId,
      eventType: 'PREFLIGHT_COMPLETED',
      actor,
      refs: { submissionSessionId: review.submission_session_id },
      payload: {
        preflight_id: reviewId,
        locked_diff_hash: snapshotHash,
        diff_entry_count: diff.entries.length,
        checklist: CHECK_KEYS.reduce(
          (acc, k) => ((acc[k] = review[k] === true), acc),
          {} as Record<string, boolean>,
        ),
      },
    });

    return completed;
  }

  // ---- E. lock invalidation (the trust-anchor re-derivation) -----------
  /**
   * Re-validate a completed preflight against current state. The caller
   * re-presents the mappings it intends to execute; provenance is read live.
   * Returns every invalidation reason (provenance/mapping change, stale
   * approval, drift, consultant reassignment).
   */
  async validateLock(
    reviewId: string,
    mappings: PreflightMappingInput[],
    applicationId: string,
  ): Promise<PreflightLockValidation> {
    const review = await this.assertReviewBelongsTo(reviewId, applicationId);

    const reasons: PreflightInvalidationReason[] = [];

    if (review.status === 'invalidated') reasons.push('already_invalidated');
    if (review.status !== 'completed') {
      // Cannot validate a lock that was never completed.
      if (!reasons.includes('already_invalidated'))
        reasons.push('not_completed');
      return { valid: false, reasons };
    }

    const appId = review.application_id;

    const active = await this.consultant.getAssignment(appId);
    if (!active) reasons.push('no_active_consultant');
    else if (active.consultant_id !== review.reviewer_id)
      reasons.push('consultant_reassigned');

    const rollup = await this.consultant.getApplicationApproval(appId);
    if (rollup.fields.some((f) => f.stale)) reasons.push('stale_approval');

    const readiness = await this.verification.evaluateExecutionReadiness(appId);
    if (!readiness.noDrift) reasons.push('verification_drift');

    // Re-derive the trust anchor from current provenance + the re-presented
    // mappings, using the LOCKED timestamp + reviewer. Any provenance/mapping
    // change shifts diffHash -> snapshot mismatch.
    const diff = await this.assembleDiff(appId, mappings);
    const recomputed = this.computeSnapshotHash(
      diff.diffHash,
      appId,
      review.reviewer_id,
      review.completed_at ?? '',
    );
    if (recomputed !== review.locked_diff_hash)
      reasons.push('provenance_or_mapping_changed');

    return { valid: reasons.length === 0, reasons };
  }

  async invalidate(reviewId: string): Promise<void> {
    await this.repo.markInvalidated(reviewId);
  }

  /** The current review: the in-review one, else the latest live (completed) lock. */
  async getActive(applicationId: string): Promise<PreflightReview | null> {
    return this.repo.getActive(applicationId);
  }

  /** Read-only accessor (no logic change) — lets the execution gate compare the
   *  current locked_diff_hash against a readback token's bound hash. */
  async getReview(reviewId: string): Promise<PreflightReview | null> {
    return this.repo.getById(reviewId);
  }
}
