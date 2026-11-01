/**
 * Canonical in-memory IPreflightRepository.
 *
 * DUP-001: two copies in two versions. The other predates a signature change
 * and lacked the `sessionId` parameter; this one matches the current interface.
 */
import type {
  ActorRef,
  PreflightCheckKey,
  PreflightReview,
} from '@visaai/types';
import type { IPreflightRepository } from '../../src/modules/preflight/preflight.repository';

/** Row factory used by this fake; lifted with it so the fake is self-contained. */
function blankPreflight(
  app: string,
  reviewer: ActorRef,
  sessionId: string | null,
): PreflightReview {
  return {
    id: `pf-${Math.random().toString(36).slice(2, 8)}`,
    application_id: app,
    submission_session_id: sessionId,
    status: 'in_review',
    reviewer_id: reviewer.id,
    reviewer_role: reviewer.role,
    passport_reviewed: false,
    dates_reviewed: false,
    travel_history_reviewed: false,
    addresses_reviewed: false,
    employment_reviewed: false,
    final_approval: false,
    locked_diff_hash: null,
    extension_version: null,
    schema_version: null,
    started_at: new Date().toISOString(),
    completed_at: null,
    invalidated_at: null,
  };
}

export class FakePreflightRepository implements IPreflightRepository {
  rows: PreflightReview[] = [];
  async insert(
    app: string,
    reviewer: ActorRef,
    sessionId: string | null,
  ): Promise<PreflightReview> {
    const r = blankPreflight(app, reviewer, sessionId);
    this.rows.push(r);
    return { ...r };
  }
  async getActive(app: string): Promise<PreflightReview | null> {
    const mine = this.rows.filter((r) => r.application_id === app);
    const live =
      mine.find((r) => r.status === 'in_review') ??
      [...mine].reverse().find((r) => r.status === 'completed');
    return live ? { ...live } : null;
  }
  async getById(id: string): Promise<PreflightReview | null> {
    const r = this.rows.find((x) => x.id === id);
    return r ? { ...r } : null;
  }
  async setCheck(
    id: string,
    check: PreflightCheckKey,
    value: boolean,
  ): Promise<PreflightReview> {
    const r = this.rows.find((x) => x.id === id);
    if (!r || r.status !== 'in_review') throw new Error('not in_review');
    (r as unknown as Record<string, boolean>)[check] = value;
    return { ...r };
  }
  async markCompleted(
    id: string,
    lockedDiffHash: string,
    completedAt: string,
    reviewer: ActorRef,
  ): Promise<PreflightReview> {
    const r = this.rows.find((x) => x.id === id);
    if (!r || r.status !== 'in_review') throw new Error('not in_review');
    r.reviewer_id = reviewer.id;
    r.reviewer_role = reviewer.role;
    r.status = 'completed';
    r.locked_diff_hash = lockedDiffHash;
    r.completed_at = completedAt;
    return { ...r };
  }
  async markInvalidated(id: string): Promise<void> {
    const r = this.rows.find((x) => x.id === id);
    if (r) {
      r.status = 'invalidated';
      r.invalidated_at = new Date().toISOString();
    }
  }
}
