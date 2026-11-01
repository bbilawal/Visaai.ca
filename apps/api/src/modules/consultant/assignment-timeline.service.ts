import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AssignmentEventType,
  AssignmentTimelineEvent,
  AuditEvent,
} from '@visaai/types';
import { AuditService } from '../audit/audit.service';
import { ASSIGNMENT_REPOSITORY } from './assignment.repository';
import type { IAssignmentRepository } from './assignment.repository';

const ASSIGNMENT_EVENT_TYPES: ReadonlySet<string> = new Set([
  'CONSULTANT_SELF_ASSIGNED',
  'CONSULTANT_ASSIGNED',
  'CONSULTANT_REASSIGNED',
  'CONSULTANT_UNASSIGNED',
]);

/** Minimal caller identity for authorization. */
export interface TimelineCaller {
  id: string;
  appRole?: 'admin' | 'consultant' | 'user';
}

/**
 * AssignmentTimelineService — READ-ONLY observability over the audit trail.
 *
 * Pure transformation: pull the application's audit events (source of truth),
 * keep only the assignment-lifecycle types, normalize the payload, and
 * safe-join actor/consultant ids to display names. No mutation, no derived
 * assignment state. Ordered ASC by sequence (= chronological). Authorization
 * gates who may read (admin, owner, or the active assignee).
 */
@Injectable()
export class AssignmentTimelineService {
  constructor(
    @Inject(ASSIGNMENT_REPOSITORY) private readonly repo: IAssignmentRepository,
    private readonly audit: AuditService,
  ) {}

  async getTimeline(
    applicationId: string,
    caller: TimelineCaller,
  ): Promise<AssignmentTimelineEvent[]> {
    const app = await this.repo.getApplicationMeta(applicationId);
    if (!app) throw new NotFoundException('application not found');

    await this.assertCanView(applicationId, app.user_id, caller);

    // Source of truth: the audit trail (already seq-ASC = chronological).
    const trail = await this.audit.getTrail(applicationId);
    const events = trail.filter((e) =>
      ASSIGNMENT_EVENT_TYPES.has(e.event_type),
    );

    // Resolve display names for every referenced id in one batch.
    const ids = new Set<string>();
    for (const e of events) {
      if (e.actor_id) ids.add(e.actor_id);
      const prev = this.prevId(e);
      const next = this.newId(e);
      if (prev) ids.add(prev);
      if (next) ids.add(next);
    }
    const names = await this.repo.getUserEmails([...ids]);

    return events.map((e) => {
      const prev = this.prevId(e);
      const next = this.newId(e);
      return {
        event_type: e.event_type as AssignmentEventType,
        application_id: e.application_id,
        actor_role: e.actor_role,
        actor_id: e.actor_id,
        actor_name: e.actor_id ? (names.get(e.actor_id) ?? null) : null,
        previous_consultant_id: prev,
        previous_consultant_name: prev ? (names.get(prev) ?? null) : null,
        new_consultant_id: next,
        new_consultant_name: next ? (names.get(next) ?? null) : null,
        timestamp: e.occurred_at,
        metadata: null, // no sensitive payload leakage; structured fields cover it
      };
    });
  }

  // ---- internals -------------------------------------------------------

  private prevId(e: AuditEvent): string | null {
    const v = e.payload?.previous_consultant_id;
    return typeof v === 'string' ? v : null;
  }
  private newId(e: AuditEvent): string | null {
    const v = e.payload?.new_consultant_id;
    return typeof v === 'string' ? v : null;
  }

  /** admin → any · owner → own app · consultant → the active assignee only. */
  private async assertCanView(
    applicationId: string,
    ownerId: string,
    caller: TimelineCaller,
  ): Promise<void> {
    if (caller.appRole === 'admin') return;
    if (caller.id === ownerId) return;
    // Any active assignee (primary OR backup) may view (P3c).
    const active = await this.repo.getActiveAssignmentFor(
      applicationId,
      caller.id,
    );
    if (active) return;
    throw new ForbiddenException('not authorized to view this timeline');
  }
}
