import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
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
    return approval;
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
  async getApplicationApproval(
    applicationId: string,
  ): Promise<ConsultantApprovalRollup> {
    const decisions = await this.repo.listDecisions(applicationId);

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
    const latestApp = decisions
      .filter((d) => d.scope === 'application')
      .sort((a, b) => (a.decided_at < b.decided_at ? 1 : -1))[0];

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

    const appScopeApproved = latestApp?.decision === 'approved';
    const noBlockedField = fields.every(
      (f) => f.decision !== 'rejected' && f.decision !== 'revoked' && !f.stale,
    );
    const noBlockedSection = sections.every(
      (s) => s.decision !== 'rejected' && s.decision !== 'revoked',
    );

    return {
      applicationId,
      fields,
      sections,
      applicationApproved:
        !!appScopeApproved && noBlockedField && noBlockedSection,
    };
  }
}
