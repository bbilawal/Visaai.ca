import type {
  ActorRef,
  PreflightCheckKey,
  PreflightReview,
} from '@visaai/types';

/** Data-access contract for preflight_reviews. */
export interface IPreflightRepository {
  insert(
    applicationId: string,
    reviewer: ActorRef,
    submissionSessionId: string | null,
  ): Promise<PreflightReview>;

  /**
   * The current review: the `in_review` row if one exists, otherwise the most
   * recent `completed` (live) lock. Invalidated reviews are never current.
   */
  getActive(applicationId: string): Promise<PreflightReview | null>;

  getById(reviewId: string): Promise<PreflightReview | null>;

  setCheck(
    reviewId: string,
    check: PreflightCheckKey,
    value: boolean,
  ): Promise<PreflightReview>;

  /** `reviewer` = who the lock is bound to (the assigned consultant). */
  markCompleted(
    reviewId: string,
    lockedDiffHash: string,
    completedAt: string,
    reviewer: ActorRef,
  ): Promise<PreflightReview>;

  markInvalidated(reviewId: string): Promise<void>;
}

export const PREFLIGHT_REPOSITORY = Symbol('IPreflightRepository');
