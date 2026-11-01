import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { ConsultantApprovalService } from '../consultant/consultant-approval.service';
import type { ApplicationApprovalLock } from '../consultant/consultant-approval.service';
import { PreflightService } from './preflight.service';
import { PreflightMappingService } from './preflight-mapping.service';

export const APPROVAL_NEEDS_LOCK_MESSAGE =
  'Lock the pre-submission review first: the application cannot be approved until the values auto-fill will enter are checked and locked.';

/**
 * Application approval requires a currently valid pre-submission review lock
 * whenever the application's route has a portal fill to review.
 *
 * Live 2026-10-19: a consultant approved while a freshly started review was
 * unlocked, so the application read "approved" with nothing checked. "Valid"
 * is the same test the review panel and the execution path use
 * (PreflightService.validateLock over the server-derived mappings). A route
 * with no portal mapping has nothing to lock and stays approvable.
 */
@Injectable()
export class ApprovalLockGate implements OnModuleInit {
  constructor(
    private readonly consultant: ConsultantApprovalService,
    private readonly preflight: PreflightService,
    private readonly mappings: PreflightMappingService,
  ) {}

  onModuleInit(): void {
    this.consultant.registerApplicationApprovalGate((id) =>
      this.assertLockedForApproval(id),
    );
    this.consultant.registerApplicationApprovalLockSource((id) =>
      this.approvalLock(id),
    );
  }

  /**
   * The lock an application approval must postdate to count (see
   * ConsultantApprovalService.approvalCoversLock). Checking approve-time alone
   * let a morning approval keep auto-fill on after a re-lock (live
   * 2026-10-19). The live lock is read first; without one, a route with a
   * portal fill has no lock to approve, and a route without one needs none.
   */
  async approvalLock(applicationId: string): Promise<ApplicationApprovalLock> {
    const review = await this.preflight.getActive(applicationId);
    if (
      review?.status === 'completed' &&
      review.locked_diff_hash &&
      review.completed_at
    ) {
      return { requiresLock: true, lockedAt: review.completed_at };
    }
    const mappings = await this.mappings.forApplication(applicationId);
    return { requiresLock: mappings.length > 0, lockedAt: null };
  }

  async assertLockedForApproval(applicationId: string): Promise<void> {
    const mappings = await this.mappings.forApplication(applicationId);
    if (mappings.length === 0) return;

    const review = await this.preflight.getActive(applicationId);
    if (!review || review.status !== 'completed' || !review.locked_diff_hash) {
      throw new ConflictException(APPROVAL_NEEDS_LOCK_MESSAGE);
    }
    const v = await this.preflight.validateLock(
      review.id,
      mappings,
      applicationId,
    );
    if (!v.valid) {
      throw new ConflictException(
        `${APPROVAL_NEEDS_LOCK_MESSAGE} The current lock is no longer valid (${v.reasons.join(', ')}); start a new review and lock it.`,
      );
    }
  }
}
