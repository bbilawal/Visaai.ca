import type {
  ConsultantApproval,
  ConsultantAssignment,
  ConsultantDecisionInput,
} from '@visaai/types';

/** Data-access contract for consultant_assignments + consultant_approvals. */
export interface IConsultantRepository {
  insertAssignment(
    applicationId: string,
    consultantId: string,
    role?: import('@visaai/types').AssignmentRole,
  ): Promise<ConsultantAssignment>;

  releaseAssignment(applicationId: string, consultantId: string): Promise<void>;

  /** The active PRIMARY assignment (role='primary'), or null — the owner/lead. */
  getActivePrimary(applicationId: string): Promise<ConsultantAssignment | null>;

  /** A specific consultant's active assignment (any role), or null — authz guard. */
  getActiveAssignmentFor(
    applicationId: string,
    consultantId: string,
  ): Promise<ConsultantAssignment | null>;

  /** Stamp completed_at on a consultant's active assignment (stops the SLA clock). */
  markCompleted(
    applicationId: string,
    consultantId: string,
    completedAt: string,
  ): Promise<void>;

  /** Full assignment history for an application, oldest -> newest. */
  listAssignments(applicationId: string): Promise<ConsultantAssignment[]>;

  insertDecision(input: ConsultantDecisionInput): Promise<ConsultantApproval>;

  listDecisions(applicationId: string): Promise<ConsultantApproval[]>;

  /** Applications with an ACTIVE assignment to this consultant (portal list). */
  listAssignedApplications(
    consultantId: string,
  ): Promise<AssignedApplication[]>;
}

/** Minimal application summary a consultant sees in their assigned list. */
export interface AssignedApplication {
  id: string;
  visa_type: string | null;
  status: string | null;
  created_at: string | null;
}

export const CONSULTANT_REPOSITORY = Symbol('IConsultantRepository');
