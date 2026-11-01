import type {
  AdminApplicationView,
  ApplicantApplicationView,
  AssignedConsultant,
  AssignmentRole,
  ConsultantAssignment,
  ConsultantQueueItem,
} from '@visaai/types';

/**
 * Raised when an insert would create a SECOND active assignment for an
 * application (Postgres 23505 on the partial unique index). The service maps
 * this to HTTP 409. This is the concurrency boundary (Scenario 7).
 */
export class AssignmentConflictError extends Error {
  constructor(message = 'application already has an active consultant') {
    super(message);
    this.name = 'AssignmentConflictError';
  }
}

/** Minimal application meta used for self-assign eligibility checks. */
export interface ApplicationMeta {
  id: string;
  user_id: string;
  destination_country: string | null;
}

/** Who/when context stamped on an assignment at (re)insert time. */
export interface AssignmentMeta {
  /** User who created the assignment (consultant id for self-assign). */
  assignedBy: string;
  assignedByRole: 'consultant' | 'admin';
  /** ISO review deadline (SLA). Reset on every (re)assignment. */
  dueAt: string;
}

/** One released-by-expiry row, returned by the sweep for event/audit emission. */
export interface ExpiredAssignment {
  application_id: string;
  consultant_id: string;
  destination_country: string | null;
}

/**
 * Server-side admin list filter. status/country/q (id ilike) are pushed to
 * PostgREST; assignee (active-assignee email substring), assignmentStatus
 * (derived) and the due_at range are applied in the repo after the fetch.
 */
export interface AdminApplicationFilter {
  status?: string;
  country?: string;
  q?: string;
  assignee?: string;
  assignmentStatus?: 'ASSIGNED' | 'UNASSIGNED';
  deadlineFrom?: string;
  deadlineTo?: string;
}

/** A consultant_countries row (active flag included for upsert/deactivate). */
export interface ConsultantCountryRow {
  country_code: string;
  active: boolean;
}

/**
 * Data-access contract for country-scoped assignment + visibility. Kept
 * separate from IConsultantRepository so the assignment concern can evolve
 * independently (and existing consultant fakes stay unaffected). The concrete
 * ConsultantRepository implements both interfaces.
 */
export interface IAssignmentRepository {
  /** Race-safe upsert; throws AssignmentConflictError on a 2nd active PRIMARY. */
  insertAssignment(
    applicationId: string,
    consultantId: string,
    role?: AssignmentRole,
    meta?: AssignmentMeta,
  ): Promise<ConsultantAssignment>;

  releaseAssignment(applicationId: string, consultantId: string): Promise<void>;

  /** Set the SLA deadline on a consultant's active assignment (admin override). */
  setDeadline(
    applicationId: string,
    consultantId: string,
    dueAt: string,
  ): Promise<void>;

  /** Stamp completed_at on a consultant's active assignment (stops the clock). */
  markCompleted(
    applicationId: string,
    consultantId: string,
    completedAt: string,
  ): Promise<void>;

  /**
   * Release every active, not-completed assignment whose due_at < `now`. Returns
   * the released rows (with destination_country) so the caller can emit audit +
   * queue events. This is the SLA expiry sweep (lazy, run on portal reads).
   */
  releaseExpired(now: string): Promise<ExpiredAssignment[]>;

  /** The active PRIMARY assignment (role='primary'), or null. */
  getActivePrimary(applicationId: string): Promise<ConsultantAssignment | null>;

  /** All active assignments (primary + backups), ordered by assigned_at. */
  listActiveAssignments(applicationId: string): Promise<ConsultantAssignment[]>;

  /** A specific consultant's active assignment (any role), or null. */
  getActiveAssignmentFor(
    applicationId: string,
    consultantId: string,
  ): Promise<ConsultantAssignment | null>;

  /** Set an active assignment's role (promote/demote). */
  setRole(
    applicationId: string,
    consultantId: string,
    role: AssignmentRole,
  ): Promise<void>;

  /** Active ISO-2 country codes this consultant covers. */
  getConsultantCountries(consultantId: string): Promise<string[]>;

  /** All consultant_countries rows for a consultant (active + inactive). */
  listConsultantCountryRows(
    consultantId: string,
  ): Promise<ConsultantCountryRow[]>;

  /**
   * Set a consultant's covered country set: upsert active=true for `codes` and
   * deactivate (active=false) every other row this consultant has. Idempotent.
   */
  setConsultantCountries(consultantId: string, codes: string[]): Promise<void>;

  /** Application owner + destination, for self-assign eligibility. */
  getApplicationMeta(applicationId: string): Promise<ApplicationMeta | null>;

  /** UNASSIGNED applications whose destination_country is in `countryCodes`. */
  listUnassignedByCountries(
    countryCodes: string[],
  ): Promise<ConsultantQueueItem[]>;

  /** Applications actively assigned to this consultant (queue-item shape). */
  listMyAssignedApplications(
    consultantId: string,
  ): Promise<ConsultantQueueItem[]>;

  /** The active assignee (id + email + assigned_at) for an application. */
  getAssignedConsultant(
    applicationId: string,
  ): Promise<AssignedConsultant | null>;

  /** All applications + derived status + assignee (admin portal). */
  listAllApplicationsAdmin(
    filter?: AdminApplicationFilter,
  ): Promise<AdminApplicationView[]>;

  /** An applicant's own applications + assignment view. */
  listApplicantApplications(
    userId: string,
  ): Promise<ApplicantApplicationView[]>;

  /** Batch id → email (deduped). Used to resolve actor/consultant display names. */
  getUserEmails(ids: string[]): Promise<Map<string, string | null>>;
}

export const ASSIGNMENT_REPOSITORY = Symbol('IAssignmentRepository');
