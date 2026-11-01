/**
 * Canonical in-memory IConsultantRepository.
 *
 * DUP-001: three copies in two versions whose only difference was parameter
 * naming (`c` vs `consultant`, `i` vs `input`) — behaviourally identical.
 */
import type {
  ConsultantApproval,
  ConsultantAssignment,
  ConsultantDecisionInput,
} from '@visaai/types';
import type { IConsultantRepository } from '../../src/modules/consultant/consultant.repository';

export class FakeConsultantRepository implements IConsultantRepository {
  async listAssignedApplications() {
    return [];
  }
  assignments: ConsultantAssignment[] = [];
  decisions: ConsultantApproval[] = [];
  private a = 0;
  private d = 0;
  private clock = 0;
  private ts() {
    return new Date(1_700_000_000_000 + ++this.clock * 1000).toISOString();
  }
  async insertAssignment(
    app: string,
    consultant: string,
  ): Promise<ConsultantAssignment> {
    const row: ConsultantAssignment = {
      id: `asg-${++this.a}`,
      application_id: app,
      consultant_id: consultant,
      role: 'primary',
      status: 'active',
      assigned_at: this.ts(),
      released_at: null,
      due_at: null,
      completed_at: null,
      assigned_by: consultant,
      assigned_by_role: 'consultant',
    };
    this.assignments.push(row);
    return row;
  }
  async markCompleted(
    app: string,
    consultant: string,
    completedAt: string,
  ): Promise<void> {
    const r = this.assignments.find(
      (x) =>
        x.application_id === app &&
        x.consultant_id === consultant &&
        x.status === 'active',
    );
    if (!r) throw new Error('markCompleted: no active assignment');
    r.completed_at = completedAt;
  }
  async releaseAssignment(app: string, consultant: string): Promise<void> {
    const r = this.assignments.find(
      (x) =>
        x.application_id === app &&
        x.consultant_id === consultant &&
        x.status === 'active',
    );
    if (r) {
      r.status = 'released';
      r.released_at = this.ts();
    }
  }
  async getActivePrimary(app: string): Promise<ConsultantAssignment | null> {
    return (
      this.assignments.find(
        (x) => x.application_id === app && x.status === 'active',
      ) ?? null
    );
  }
  async getActiveAssignmentFor(
    app: string,
    consultantId: string,
  ): Promise<ConsultantAssignment | null> {
    return (
      this.assignments.find(
        (x) =>
          x.application_id === app &&
          x.consultant_id === consultantId &&
          x.status === 'active',
      ) ?? null
    );
  }
  async listAssignments(app: string): Promise<ConsultantAssignment[]> {
    return this.assignments.filter((x) => x.application_id === app);
  }
  async insertDecision(
    input: ConsultantDecisionInput,
  ): Promise<ConsultantApproval> {
    const row: ConsultantApproval = {
      id: `dec-${++this.d}`,
      application_id: input.applicationId,
      consultant_id: input.consultantId,
      scope: input.scope,
      field_key: input.fieldKey ?? null,
      section: input.section ?? null,
      decision: input.decision,
      value_hash: input.valueHash ?? null,
      reason: input.reason ?? null,
      decided_at: this.ts(),
    };
    this.decisions.push(row);
    return row;
  }
  async listDecisions(app: string): Promise<ConsultantApproval[]> {
    return this.decisions.filter((x) => x.application_id === app);
  }
}
