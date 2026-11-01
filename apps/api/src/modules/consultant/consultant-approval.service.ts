import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  ConsultantApproval,
  ConsultantApprovalRollup,
  ConsultantApprovalScope,
  ConsultantAssignment,
  ConsultantDecision,
  FieldApprovalStatus,
  SectionApprovalStatus,
  ValueHash,
} from '@visaai/types';
import { AuditService } from '../audit/audit.service';
import { ProvenanceService } from '../provenance/provenance.service';
import { CONSULTANT_REPOSITORY } from './consultant.repository';
import type { IConsultantRepository } from './consultant.repository';
import { PlanReviewPayoutService } from '../payouts/plan-review-payout.service';

/**
 * A precondition on an application-scope APPROVE, registered by a module that
 * owns the state it checks (PreflightModule: the pre-submission review lock).
 * Throws to refuse the approval. Registered rather than injected because
 * PreflightModule already imports ConsultantModule.
 */
export type ApplicationApprovalGate = (applicationId: string) => Promise<void>;

/**
 * The pre-submission lock an application approval has to cover, from the
 * module that owns it (PreflightModule). requiresLock false: the route has no
 * portal fill, so any application approval counts. Otherwise lockedAt is the
 * live lock's completed_at, or null when there is no live lock.
 */
export interface ApplicationApprovalLock {
  requiresLock: boolean;
  lockedAt: string | null;
}
export type ApplicationApprovalLockSource = (
  applicationId: string,
) => Promise<ApplicationApprovalLock>;

/**
 * A standing condition that keeps an application from being approved, from
 * the module that owns the state (ReviewItemsModule: a document the consultant
 * asked to have re-uploaded, or rejected, with no replacement yet). Returns
 * the reason the consultant sees, or null when clear.
 *
 * Unlike an ApplicationApprovalGate (checked once, at approve time) a blocker
 * also counts in the rollup: an approval followed by a re-upload request is no
 * longer an approved application. Kept apart from the gates so the
 * "no gate registered" fail-closed check still means "the pre-submission lock
 * check is not loaded".
 */
export type ApplicationApprovalBlocker = (
  applicationId: string,
) => Promise<string | null>;

/**
 * ConsultantApprovalService — external authority gate.
 *
 * Owns the assignment + decision lifecycles, value_hash-bound approvals (stale
 * when the field's current value_hash changes), and the application approval
 * rollup. Revocation invalidates downstream readiness (a revoked/rejected
 * decision makes the rollup not-approved). Every decision emits an audit event.
 *
 * NOT wired into any workflow/execution/extension/OCR path (frozen). Decisions
 * are recorded here; driving VerificationService state from them is workflow
 * integration deferred to a later phase.
 */
@Injectable()
export class ConsultantApprovalService {
  constructor(
    @Inject(CONSULTANT_REPOSITORY) private readonly repo: IConsultantRepository,
    private readonly provenance: ProvenanceService,
    private readonly audit: AuditService,
    private readonly planPayout: PlanReviewPayoutService,
  ) {}

  private approvalGates: ApplicationApprovalGate[] = [];

  /** See ApplicationApprovalGate. Called once at module init by the owner. */
  registerApplicationApprovalGate(gate: ApplicationApprovalGate): void {
    this.approvalGates.push(gate);
  }

  private readonly log = new Logger(ConsultantApprovalService.name);

  private approvalBlockers: ApplicationApprovalBlocker[] = [];

  /** See ApplicationApprovalBlocker. Called once at module init by the owner. */
  registerApplicationApprovalBlocker(
    blocker: ApplicationApprovalBlocker,
  ): void {
    this.approvalBlockers.push(blocker);
  }

  /** Reasons the application cannot be approved right now. Throws on a read error. */
  private async approvalBlockerReasons(
    applicationId: string,
  ): Promise<string[]> {
    const reasons: string[] = [];
    for (const blocker of this.approvalBlockers) {
      const reason = await blocker(applicationId);
      if (reason) reasons.push(reason);
    }
    return reasons;
  }

  private approvalLockSource: ApplicationApprovalLockSource | null = null;

  /** See ApplicationApprovalLock. Called once at module init by the owner. */
  registerApplicationApprovalLockSource(
    source: ApplicationApprovalLockSource,
  ): void {
    this.approvalLockSource = source;
  }

  /**
   * Does an application approval decided at `decidedAt` approve the values
   * locked NOW? Live 2026-10-19: a morning approval kept auto-fill on after
   * the data changed and the review was re-locked at 15:19 — the new approval
   * had failed, yet the Submit page read "Approved" off the old one. Only an
   * approval decided at or after the live lock's completed_at counts.
   * 'stale': it predates the live lock, or there is no live lock. 'unknown':
   * no lock source, an unreadable lock, or an unparsable time — not approved
   * either (fail closed), but not reported as the consultant's to fix.
   */
  private async approvalCoversLock(
    applicationId: string,
    decidedAt: string,
  ): Promise<'covered' | 'stale' | 'unknown'> {
    if (!this.approvalLockSource) return 'unknown';
    try {
      const lock = await this.approvalLockSource(applicationId);
      if (!lock.requiresLock) return 'covered';
      if (!lock.lockedAt) return 'stale';
      const decided = Date.parse(decidedAt);
      const locked = Date.parse(lock.lockedAt);
      if (Number.isNaN(decided) || Number.isNaN(locked)) return 'unknown';
      return decided >= locked ? 'covered' : 'stale';
    } catch {
      return 'unknown';
    }
  }

  // ---- A. assignment lifecycle -----------------------------------------
  async assign(
    applicationId: string,
    consultantId: string,
  ): Promise<ConsultantAssignment> {
    const active = await this.repo.getActivePrimary(applicationId);
    if (active) {
      throw new BadRequestException(
        `application ${applicationId} already has an active consultant; reassign instead`,
      );
    }
    return this.repo.insertAssignment(applicationId, consultantId);
  }

  /** Release the current active consultant and assign a new one. */
  async reassign(
    applicationId: string,
    newConsultantId: string,
  ): Promise<ConsultantAssignment> {
    const active = await this.repo.getActivePrimary(applicationId);
    if (active)
      await this.repo.releaseAssignment(applicationId, active.consultant_id);
    return this.repo.insertAssignment(applicationId, newConsultantId);
  }

  async getAssignment(
    applicationId: string,
  ): Promise<ConsultantAssignment | null> {
    return this.repo.getActivePrimary(applicationId);
  }

  async getAssignmentHistory(
    applicationId: string,
  ): Promise<ConsultantAssignment[]> {
    return this.repo.listAssignments(applicationId);
  }

  /** Applications actively assigned to this consultant (portal list). */
  listAssignedApplications(consultantId: string) {
    return this.repo.listAssignedApplications(consultantId);
  }

  /** Authorization guard: only the active assignee may act. */
  async assertAssigned(
    applicationId: string,
    consultantId: string,
  ): Promise<void> {
    // Authz: ANY active assignee (primary OR backup) may act — backups have
    // full access by design (P3c). getActiveAssignmentFor returns the caller's
    // own active row, or null if they are not assigned.
    const active = await this.repo.getActiveAssignmentFor(
      applicationId,
      consultantId,
    );
    if (!active) {
      throw new ForbiddenException(
        `consultant ${consultantId} is not the active assignee`,
      );
    }
  }

  // ---- B. decision recording + F. audit --------------------------------
  async reviewField(
    applicationId: string,
    consultantId: string,
    fieldKey: string,
    valueHash: ValueHash,
  ): Promise<ConsultantApproval> {
    return this.record(
      {
        applicationId,
        consultantId,
        scope: 'field',
        fieldKey,
        decision: 'reviewed',
        valueHash,
      },
      'CONSULTANT_REVIEWED',
    );
  }

  // ---- C. value-hash binding (approve binds application+field+value_hash) ----
  async approveField(
    applicationId: string,
    consultantId: string,
    fieldKey: string,
    valueHash: ValueHash,
  ): Promise<ConsultantApproval> {
    return this.record(
      {
        applicationId,
        consultantId,
        scope: 'field',
        fieldKey,
        decision: 'approved',
        valueHash,
      },
      'CONSULTANT_APPROVED',
    );
  }

  async approveSection(
    applicationId: string,
    consultantId: string,
    section: string,
  ): Promise<ConsultantApproval> {
    return this.record(
      {
        applicationId,
        consultantId,
        scope: 'section',
        section,
        decision: 'approved',
      },
      'CONSULTANT_APPROVED',
    );
  }

  async approveApplication(
    applicationId: string,
    consultantId: string,
  ): Promise<ConsultantApproval> {
    // Authorize first (403 for a non-assignee), then the preconditions: the
    // approval is what turns auto-fill on, so it must not land while the
    // values auto-fill would write are unchecked (live 2026-10-19).
    await this.assertAssigned(applicationId, consultantId);
    // Fail closed: no registered precondition means the module that checks the
    // pre-submission lock is not loaded, not that there is nothing to check.
    if (this.approvalGates.length === 0) {
      throw new ServiceUnavailableException(
        'Application approval is unavailable: the pre-submission review check is not loaded.',
      );
    }
    for (const gate of this.approvalGates) await gate(applicationId);
    // Live 2026-10-20: an application was approvable while one of its documents
    // was marked "Needs re-upload" — fields and sections blocked, documents
    // did not.
    const blockers = await this.approvalBlockerReasons(applicationId);
    // Live 2026-10-20: rejected values made the rollup not-approved, yet this
    // recorded "approved" — the consultant saw an approval the applicant's
    // side did not. Same rule as the rollup.
    const { fields, sections } = await this.fieldAndSectionStatus(
      applicationId,
      await this.repo.listDecisions(applicationId),
    );
    const fieldReason = this.fieldBlockerReason(fields, sections);
    if (fieldReason) blockers.unshift(fieldReason);
    if (blockers.length > 0) {
      throw new ConflictException(blockers.join(' '));
    }
    const approval = await this.record(
      {
        applicationId,
        consultantId,
        scope: 'application',
        decision: 'approved',
      },
      'CONSULTANT_APPROVED',
    );
    await this.planPayout.creditExpertReview(applicationId, consultantId);
    await this.stopSlaClock(applicationId, consultantId);
    return approval;
  }

  /**
   * An application decision IS the consultant completing their review. Without
   * stamping completed_at, the lazy SLA sweep released the assignment once its
   * due date passed — after the consultant had approved — which voided the
   * locked pre-submission review and disabled the applicant's auto-fill
   * ("No consultant is assigned", dry run 2026-10-16). Best effort: the
   * decision itself is already recorded.
   */
  private async stopSlaClock(
    applicationId: string,
    consultantId: string,
  ): Promise<void> {
    try {
      const mine = await this.repo.getActiveAssignmentFor(
        applicationId,
        consultantId,
      );
      if (!mine || mine.completed_at) return;
      await this.repo.markCompleted(
        applicationId,
        consultantId,
        new Date().toISOString(),
      );
    } catch {
      // The decision stands; the clock can still be stopped from the portal.
    }
  }

  /**
   * Application-scope rejection. Mirrors approveApplication but records a
   * 'rejected' decision (reason required), making the rollup not-approved.
   * Reuses the FIELD_EDITED audit convention used by rejectField.
   */
  async rejectApplication(
    applicationId: string,
    consultantId: string,
    reason: string,
  ): Promise<ConsultantApproval> {
    if (!reason?.trim())
      throw new BadRequestException('reject requires a reason');
    const approval = await this.record(
      {
        applicationId,
        consultantId,
        scope: 'application',
        decision: 'rejected',
        reason,
      },
      'FIELD_EDITED',
      { action: 'rejected' },
    );
    // A rejection is the same review work as an approval — the consultant is
    // owed either way.
    await this.planPayout.creditExpertReview(applicationId, consultantId);
    await this.stopSlaClock(applicationId, consultantId);
    return approval;
  }

  async rejectField(
    applicationId: string,
    consultantId: string,
    fieldKey: string,
    reason: string,
  ): Promise<ConsultantApproval> {
    if (!reason?.trim())
      throw new BadRequestException('reject requires a reason');
    return this.record(
      {
        applicationId,
        consultantId,
        scope: 'field',
        fieldKey,
        decision: 'rejected',
        reason,
      },
      'FIELD_EDITED',
      { action: 'rejected' },
    );
  }

  /**
   * The field does not apply to this application (OCR junk such as a sponsor
   * job title read off an unrelated document). Unlike rejectField this does
   * NOT block auto-fill or the application approval: the field is left out of
   * the auto-fill mappings (PreflightMappingService) and nothing else changes.
   * A later approve/reject on the same field supersedes it (latest wins).
   */
  async markFieldNotApplicable(
    applicationId: string,
    consultantId: string,
    fieldKey: string,
    reason?: string,
  ): Promise<ConsultantApproval> {
    return this.record(
      {
        applicationId,
        consultantId,
        scope: 'field',
        fieldKey,
        decision: 'not_applicable',
        reason: reason?.trim() || null,
      },
      'FIELD_EDITED',
      { action: 'not_applicable' },
    );
  }

  /** Field keys whose LATEST field-scope decision is 'not_applicable'. */
  async notApplicableFieldKeys(applicationId: string): Promise<Set<string>> {
    const latest = new Map<string, ConsultantApproval>();
    for (const d of await this.repo.listDecisions(applicationId)) {
      if (d.scope !== 'field' || !d.field_key) continue;
      const prev = latest.get(d.field_key);
      if (!prev || d.decided_at > prev.decided_at) latest.set(d.field_key, d);
    }
    return new Set(
      [...latest.values()]
        .filter((d) => d.decision === 'not_applicable')
        .map((d) => d.field_key as string),
    );
  }

  // ---- E. revocation (invalidates downstream readiness) ----------------
  async revoke(
    applicationId: string,
    consultantId: string,
    target: {
      scope: ConsultantApprovalScope;
      fieldKey?: string;
      section?: string;
    },
    reason: string,
  ): Promise<ConsultantApproval> {
    if (!reason?.trim())
      throw new BadRequestException('revoke requires a reason');
    return this.record(
      {
        applicationId,
        consultantId,
        scope: target.scope,
        fieldKey: target.fieldKey ?? null,
        section: target.section ?? null,
        decision: 'revoked',
        reason,
      },
      'FIELD_EDITED',
      { action: 'revoked' },
    );
  }

  /** Shared: assignment check -> persist decision -> audit. */
  private async record(
    input: {
      applicationId: string;
      consultantId: string;
      scope: ConsultantApprovalScope;
      fieldKey?: string | null;
      section?: string | null;
      decision: ConsultantDecision;
      valueHash?: ValueHash | null;
      reason?: string | null;
    },
    auditType: 'CONSULTANT_REVIEWED' | 'CONSULTANT_APPROVED' | 'FIELD_EDITED',
    extraPayload: Record<string, unknown> = {},
  ): Promise<ConsultantApproval> {
    await this.assertAssigned(input.applicationId, input.consultantId);

    const row = await this.repo.insertDecision({
      applicationId: input.applicationId,
      consultantId: input.consultantId,
      scope: input.scope,
      fieldKey: input.fieldKey ?? null,
      section: input.section ?? null,
      decision: input.decision,
      valueHash: input.valueHash ?? null,
      reason: input.reason ?? null,
    });

    await this.audit.append({
      applicationId: input.applicationId,
      eventType: auditType,
      actor: { id: input.consultantId, role: 'consultant' },
      valueHash: input.valueHash ?? null,
      refs: { fieldKey: input.fieldKey ?? null },
      payload: {
        scope: input.scope,
        section: input.section ?? null,
        decision: input.decision,
        ...extraPayload,
      },
    });

    return row;
  }

  async listDecisions(applicationId: string): Promise<ConsultantApproval[]> {
    return this.repo.listDecisions(applicationId);
  }

  // ---- C. staleness ----------------------------------------------------
  /** An approval is stale when the field's CURRENT value_hash != the approved one. */
  async isApprovalStale(
    applicationId: string,
    fieldKey: string,
    approvedValueHash: ValueHash | null,
  ): Promise<boolean> {
    const current = await this.provenance.getCurrentFieldVersion(
      applicationId,
      fieldKey,
    );
    return (current?.value_hash ?? null) !== approvedValueHash;
  }

  // ---- D. application approval rollup -----------------------------------
  /**
   * The latest decision per field and per section, with staleness. One source
   * for the rollup and for the approve endpoint, so the endpoint never records
   * an approval the rollup would call not-approved (live 2026-10-20).
   */
  private async fieldAndSectionStatus(
    applicationId: string,
    decisions: ConsultantApproval[],
  ): Promise<{
    fields: FieldApprovalStatus[];
    sections: SectionApprovalStatus[];
  }> {
    const latestByTarget = (
      scope: ConsultantApprovalScope,
      keyOf: (d: ConsultantApproval) => string,
    ) => {
      const map = new Map<string, ConsultantApproval>();
      for (const d of decisions.filter((x) => x.scope === scope)) {
        const k = keyOf(d);
        const prev = map.get(k);
        if (!prev || d.decided_at > prev.decided_at) map.set(k, d);
      }
      return map;
    };

    const latestField = latestByTarget('field', (d) => d.field_key ?? '');
    const latestSection = latestByTarget('section', (d) => d.section ?? '');
    const fields: FieldApprovalStatus[] = await Promise.all(
      [...latestField.values()].map(async (d) => {
        const stale =
          d.decision === 'approved'
            ? await this.isApprovalStale(
                applicationId,
                d.field_key ?? '',
                d.value_hash,
              )
            : false;
        return {
          fieldKey: d.field_key ?? '',
          decision: d.decision,
          approved: d.decision === 'approved' && !stale,
          stale,
          approvedValueHash: d.value_hash,
        };
      }),
    );

    const sections: SectionApprovalStatus[] = [...latestSection.values()].map(
      (d) => ({
        section: d.section ?? '',
        decision: d.decision,
        approved: d.decision === 'approved',
      }),
    );

    return { fields, sections };
  }

  /** Why the field and section decisions block approval, or null. */
  private fieldBlockerReason(
    fields: FieldApprovalStatus[],
    sections: SectionApprovalStatus[],
  ): string | null {
    const rejected = fields
      .filter((f) => f.decision === 'rejected' || f.decision === 'revoked')
      .map((f) => f.fieldKey);
    const stale = fields.filter((f) => f.stale).map((f) => f.fieldKey);
    const blockedSections = sections
      .filter((x) => x.decision === 'rejected' || x.decision === 'revoked')
      .map((x) => x.section);
    const parts: string[] = [];
    if (rejected.length > 0)
      parts.push(`rejected or revoked values: ${rejected.join(', ')}`);
    if (stale.length > 0)
      parts.push(`values changed since you approved them: ${stale.join(', ')}`);
    if (blockedSections.length > 0)
      parts.push(`rejected or revoked sections: ${blockedSections.join(', ')}`);
    if (parts.length === 0) return null;
    return `Cannot approve yet: ${parts.join('; ')}. Under Fields, approve each one (correct it first if it is wrong), or mark it not applicable.`;
  }

  async getApplicationApproval(
    applicationId: string,
  ): Promise<ConsultantApprovalRollup> {
    const decisions = await this.repo.listDecisions(applicationId);
    const latestApp = decisions
      .filter((d) => d.scope === 'application')
      .sort((a, b) => (a.decided_at < b.decided_at ? 1 : -1))[0];

    const { fields, sections } = await this.fieldAndSectionStatus(
      applicationId,
      decisions,
    );

    const coverage =
      latestApp?.decision === 'approved'
        ? await this.approvalCoversLock(applicationId, latestApp.decided_at)
        : null;
    const appScopeApproved = coverage === 'covered';
    // Approved, but before the lock now in force (or a new review is open):
    // the consultant has to lock and approve again. An unreadable lock is
    // not-approved without this flag — it is not theirs to fix.
    const applicationApprovalStale = coverage === 'stale';
    const noBlockedField = fields.every(
      (f) => f.decision !== 'rejected' && f.decision !== 'revoked' && !f.stale,
    );
    const noBlockedSection = sections.every(
      (s) => s.decision !== 'rejected' && s.decision !== 'revoked',
    );
    // Fail closed — an unreadable blocker is not a clear application — but say
    // so distinctly: a transient read error is not the consultant's approval
    // missing, and must not be reported to the applicant as one.
    let approvalBlockers: string[] = [];
    let approvalCheckUnavailable = false;
    try {
      approvalBlockers = await this.approvalBlockerReasons(applicationId);
    } catch (err) {
      approvalCheckUnavailable = true;
      this.log.warn(
        `approval blockers unreadable for ${applicationId}: ${(err as Error).message}`,
      );
    }

    return {
      applicationId,
      fields,
      sections,
      applicationApproved:
        !!appScopeApproved &&
        noBlockedField &&
        noBlockedSection &&
        approvalBlockers.length === 0 &&
        !approvalCheckUnavailable,
      applicationApprovalStale,
      approvalBlockers,
      approvalCheckUnavailable,
    };
  }
}
