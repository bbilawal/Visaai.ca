import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  NotFoundException,
} from '@nestjs/common';
import type {
  AdminApplicationView,
  ApplicantApplicationView,
  AuditEventType,
  ConsultantAssignment,
  ConsultantQueueResult,
} from '@visaai/types';
import { AuditService } from '../audit/audit.service';
import { AssignmentEventBus } from '../event-bus/assignment-event-bus';
import { NotificationEventBus } from '../notifications/notification-event-bus';
import { AnalyticsEventBus } from '../analytics/analytics-event-bus';
import { makeServerEvent } from '../analytics/events/catalog';
import {
  ASSIGNMENT_REPOSITORY,
  AssignmentConflictError,
  type AdminApplicationFilter,
  type ApplicationMeta,
  type AssignmentMeta,
} from './assignment.repository';
import type { IAssignmentRepository } from './assignment.repository';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/configuration';
import {
  isCountryInSiteScope,
  readSiteMode,
  siteDefaultCountry,
  type SiteMode,
} from '../../config/site-scope';
import { consultantCoversCountry, strategyRegistry } from '../../strategies';

/** Default consultant review window (SLA) granted on every (re)assignment. */
export const DEFAULT_REVIEW_HOURS = 24;
/** Bounds for an admin-set review window (1 hour .. 30 days). */
export const MIN_REVIEW_HOURS = 1;
export const MAX_REVIEW_HOURS = 24 * 30;
/** Bounds for an absolute admin-set deadline: now+5min .. now+1year. */
export const MIN_DEADLINE_LEAD_MS = 5 * 60_000;
export const MAX_DEADLINE_HORIZON_MS = 365 * 24 * 3_600_000;

/**
 * AssignmentService — country-scoped consultant assignment authority.
 *
 * Owns the assignment lifecycle for the marketplace flow: consultant
 * self-assign (country-eligible), admin assign / reassign / unassign, and the
 * per-role visibility resolvers. Assignment STATUS is always derived from the
 * active consultant_assignments row (never stored). Concurrency is enforced by
 * the DB partial-unique index (one active per application) surfaced here as a
 * 409. Every mutation emits a typed audit event with previous/new consultant.
 */
@Injectable()
export class AssignmentService {
  constructor(
    @Inject(ASSIGNMENT_REPOSITORY) private readonly repo: IAssignmentRepository,
    private readonly audit: AuditService,
    private readonly bus: AssignmentEventBus,
    // @Optional: best-effort notification emitter. Provided by the @Global
    // NotificationBusModule in the running app; omitted in unit tests (no-op).
    @Optional() private readonly notifBus?: NotificationEventBus,
    @Optional() private readonly analytics?: AnalyticsEventBus,
    // @Optional: SITE_MODE source. Absent in unit tests → global (unscoped).
    @Optional() private readonly config?: ConfigService<Env>,
  ) {}

  private get siteMode(): SiteMode {
    return readSiteMode(this.config);
  }

  /**
   * Notify the application owner that a consultant is now on their case.
   * Best-effort — a notification failure must NEVER block the assignment.
   */
  private notifyAssigned(ownerUserId: string, applicationId: string): void {
    try {
      this.notifBus?.emit({
        type: 'consultant.assigned',
        userId: ownerUserId,
        applicationId,
      });
    } catch {
      /* best-effort */
    }
  }

  // ---- visibility resolvers --------------------------------------------

  /** Active ISO-2 countries a consultant covers (used by the SSE filter). */
  listConsultantCountries(consultantId: string): Promise<string[]> {
    return this.repo.getConsultantCountries(consultantId);
  }

  // ---- admin: consultant country mapping -------------------------------

  /** Admin reads a consultant's ACTIVE covered ISO-2 codes. */
  getConsultantCountries(consultantId: string): Promise<string[]> {
    return this.repo.getConsultantCountries(consultantId);
  }

  /**
   * Admin sets a consultant's covered country set. Each code must be a supported
   * country in the strategy registry (ISO-2, or the 'SCHENGEN' bloc) else 400.
   * Codes are assumed deduped/upper-cased by the DTO. Returns the resulting
   * active codes. Upsert active=true for `codes`; deactivate the rest.
   */
  async setConsultantCountries(
    consultantId: string,
    codes: string[],
  ): Promise<string[]> {
    for (const code of codes) {
      // The Canada-only site never maps a consultant outside its scope.
      if (!isCountryInSiteScope(this.siteMode, code)) {
        throw new BadRequestException(
          `country not served by this site: ${code}`,
        );
      }
      // Registry covers selectable ISO-2 codes + the resolvable SCHENGEN bloc,
      // matching consultantCoversCountry's coverage semantics.
      if (!strategyRegistry.getCountry(code)) {
        throw new BadRequestException(`unsupported country code: ${code}`);
      }
    }
    await this.repo.setConsultantCountries(consultantId, codes);
    return this.repo.getConsultantCountries(consultantId);
  }

  /** Consultant portal: eligible UNASSIGNED queue + my active-assigned apps. */
  async getConsultantQueue(
    consultantId: string,
  ): Promise<ConsultantQueueResult> {
    // Lazy SLA sweep: release past-due, not-completed assignments so expired
    // applications reappear in the queue (no cron — runs on portal reads).
    await this.releaseExpired();
    const countries = (
      await this.repo.getConsultantCountries(consultantId)
    ).filter((code) => isCountryInSiteScope(this.siteMode, code));
    const [queue, mine] = await Promise.all([
      this.repo.listUnassignedByCountries(countries),
      this.repo.listMyAssignedApplications(consultantId),
    ]);
    return { queue, mine: this.withinSiteScope(mine) };
  }

  /** Admin portal: all applications + derived status + assignee + date. */
  async listAllForAdmin(
    filter?: AdminApplicationFilter,
  ): Promise<AdminApplicationView[]> {
    // Sweep first so the admin sees expired apps as UNASSIGNED (re-assignable).
    await this.releaseExpired();
    // Canada-only site: the admin list is pinned to Canada whatever the query.
    const pinned = siteDefaultCountry(this.siteMode);
    return this.repo.listAllApplicationsAdmin(
      pinned ? { ...filter, country: pinned } : filter,
    );
  }

  /** Applicant portal: own applications + assigned consultant + status. */
  async getApplicantView(userId: string): Promise<ApplicantApplicationView[]> {
    return this.withinSiteScope(
      await this.repo.listApplicantApplications(userId),
    );
  }

  /**
   * Drops rows whose destination is outside this site's scope (a Canada-only
   * site sharing data with the global one). Rows with no destination yet are
   * kept. Global mode returns the input unchanged.
   */
  private withinSiteScope<T extends { destination_country: string | null }>(
    rows: T[],
  ): T[] {
    if (this.siteMode === 'global') return rows;
    return rows.filter(
      (r) =>
        r.destination_country === null ||
        isCountryInSiteScope(this.siteMode, r.destination_country),
    );
  }

  // ---- mutations -------------------------------------------------------

  /**
   * Consultant claims an UNASSIGNED application they are country-eligible for.
   * Eligibility is checked, then the insert races against the DB unique index:
   * the loser gets 409. Emits CONSULTANT_SELF_ASSIGNED.
   */
  async selfAssign(
    applicationId: string,
    consultantId: string,
  ): Promise<ConsultantAssignment> {
    const app = await this.repo.getApplicationMeta(applicationId);
    if (!app) throw new NotFoundException('application not found');
    notOwnApplication(app, consultantId);

    if (!app.destination_country) {
      throw new ForbiddenException(
        'application has no destination country; not eligible for self-assignment',
      );
    }
    const countries = await this.repo.getConsultantCountries(consultantId);
    // Bloc-aware eligibility: a 'SCHENGEN' consultant covers any member code.
    if (!consultantCoversCountry(countries, app.destination_country)) {
      throw new ForbiddenException(
        `not eligible: ${app.destination_country} is not in your assigned countries`,
      );
    }

    // First eligible claimant becomes primary; a later claimant on an
    // already-owned app becomes a backup (full-access coverage).
    const primary = await this.repo.getActivePrimary(applicationId);
    const role: import('@visaai/types').AssignmentRole = primary
      ? 'backup'
      : 'primary';
    const assignment = await this.insertOrConflict(
      applicationId,
      consultantId,
      role,
      this.meta(consultantId, 'consultant'),
    );
    await this.emit(applicationId, 'CONSULTANT_SELF_ASSIGNED', {
      actorId: consultantId,
      actorRole: 'consultant',
      previousConsultantId: null,
      newConsultantId: consultantId,
    });
    this.bus.emit({
      type: 'APPLICATION_SELF_ASSIGNED',
      application_id: applicationId,
      destination_country: app.destination_country,
      previous_consultant_id: null,
      new_consultant_id: consultantId,
    });
    this.notifyAssigned(app.user_id, applicationId);
    // Analytics: allowlisted non-PII fields only (ids/enums — no profile data).
    this.analytics?.emitSafe(
      makeServerEvent('consultant.assigned', {
        user_id: app.user_id,
        application_id: applicationId,
        props: {
          role,
          consultant_id: consultantId,
          assigned_by_role: 'consultant',
        },
      }),
    );
    return assignment;
  }

  /** Admin assigns an UNASSIGNED application. 409 if already active. */
  async adminAssign(
    applicationId: string,
    consultantId: string,
    adminId: string,
  ): Promise<ConsultantAssignment> {
    const app = await this.loadApp(applicationId);
    notOwnApplication(app, consultantId);
    const active = await this.repo.getActivePrimary(applicationId);
    if (active) {
      throw new ConflictException(
        'application already has an active consultant; use reassign',
      );
    }
    const assignment = await this.insertOrConflict(
      applicationId,
      consultantId,
      'primary',
      this.meta(adminId, 'admin'),
    );
    await this.emit(applicationId, 'CONSULTANT_ASSIGNED', {
      actorId: adminId,
      actorRole: 'admin',
      previousConsultantId: null,
      newConsultantId: consultantId,
    });
    this.bus.emit({
      type: 'APPLICATION_ASSIGNED',
      application_id: applicationId,
      destination_country: app.destination_country,
      previous_consultant_id: null,
      new_consultant_id: consultantId,
    });
    this.notifyAssigned(app.user_id, applicationId);
    this.analytics?.emitSafe(
      makeServerEvent('consultant.assigned', {
        user_id: app.user_id,
        application_id: applicationId,
        props: {
          role: 'primary',
          consultant_id: consultantId,
          assigned_by_role: 'admin',
        },
      }),
    );
    return assignment;
  }

  /**
   * Admin adds a BACKUP consultant (country-eligible) to an application. Backups
   * have full active-assignee access (is_active_assignee); role is a label +
   * notification routing. 409 if that consultant is already assigned.
   */
  async adminAddBackup(
    applicationId: string,
    consultantId: string,
    adminId: string,
  ): Promise<ConsultantAssignment> {
    const app = await this.loadApp(applicationId);
    notOwnApplication(app, consultantId);
    if (!app.destination_country) {
      throw new ForbiddenException('application has no destination country');
    }
    const countries = await this.repo.getConsultantCountries(consultantId);
    if (!consultantCoversCountry(countries, app.destination_country)) {
      throw new ForbiddenException(
        `not eligible: ${app.destination_country} is not in the consultant's countries`,
      );
    }
    const assignment = await this.insertOrConflict(
      applicationId,
      consultantId,
      'backup',
      this.meta(adminId, 'admin'),
    );
    await this.emit(applicationId, 'CONSULTANT_BACKUP_ADDED', {
      actorId: adminId,
      actorRole: 'admin',
      previousConsultantId: null,
      newConsultantId: consultantId,
    });
    this.bus.emit({
      type: 'APPLICATION_BACKUP_ADDED',
      application_id: applicationId,
      destination_country: app.destination_country,
      previous_consultant_id: null,
      new_consultant_id: consultantId,
    });
    this.analytics?.emitSafe(
      makeServerEvent('consultant.assigned', {
        user_id: app.user_id,
        application_id: applicationId,
        props: {
          role: 'backup',
          consultant_id: consultantId,
          assigned_by_role: 'admin',
        },
      }),
    );
    return assignment;
  }

  /**
   * Admin changes the owner: release the current active consultant (if any) and
   * assign the new one. History is retained (released row). Emits
   * CONSULTANT_REASSIGNED with previous + new consultant.
   */
  async adminReassign(
    applicationId: string,
    newConsultantId: string,
    adminId: string,
  ): Promise<ConsultantAssignment> {
    const app = await this.loadApp(applicationId);
    notOwnApplication(app, newConsultantId);
    const active = await this.repo.getActivePrimary(applicationId);
    const previousConsultantId = active?.consultant_id ?? null;

    if (previousConsultantId === newConsultantId) {
      // already the active owner — no-op assignment, no audit churn
      return active!;
    }
    if (active) {
      await this.repo.releaseAssignment(applicationId, active.consultant_id);
    }
    const assignment = await this.insertOrConflict(
      applicationId,
      newConsultantId,
      'primary',
      this.meta(adminId, 'admin'),
    );
    await this.emit(applicationId, 'CONSULTANT_REASSIGNED', {
      actorId: adminId,
      actorRole: 'admin',
      previousConsultantId,
      newConsultantId,
    });
    this.bus.emit({
      type: 'APPLICATION_REASSIGNED',
      application_id: applicationId,
      destination_country: app.destination_country,
      previous_consultant_id: previousConsultantId,
      new_consultant_id: newConsultantId,
    });
    this.notifyAssigned(app.user_id, applicationId);
    this.analytics?.emitSafe(
      makeServerEvent('consultant.assigned', {
        user_id: app.user_id,
        application_id: applicationId,
        props: {
          role: 'primary',
          consultant_id: newConsultantId,
          previous_consultant_id: previousConsultantId,
          assigned_by_role: 'admin',
        },
      }),
    );
    return assignment;
  }

  /** Admin removes ownership -> application returns to UNASSIGNED. */
  async unassign(applicationId: string, adminId: string): Promise<void> {
    const app = await this.loadApp(applicationId);
    const active = await this.repo.getActivePrimary(applicationId);
    if (!active) return; // already unassigned — idempotent
    await this.repo.releaseAssignment(applicationId, active.consultant_id);
    await this.emit(applicationId, 'CONSULTANT_UNASSIGNED', {
      actorId: adminId,
      actorRole: 'admin',
      previousConsultantId: active.consultant_id,
      newConsultantId: null,
    });
    this.bus.emit({
      type: 'APPLICATION_UNASSIGNED',
      application_id: applicationId,
      destination_country: app.destination_country,
      previous_consultant_id: active.consultant_id,
      new_consultant_id: null,
    });
  }

  /**
   * Admin promotes an active BACKUP to primary. Demotes the current primary to
   * backup first (keeps them as coverage), then promotes the target — this order
   * never violates the one-active-primary index (0 primaries transiently is OK).
   */
  async adminPromote(
    applicationId: string,
    consultantId: string,
    adminId: string,
  ): Promise<void> {
    const app = await this.loadApp(applicationId);
    notOwnApplication(app, consultantId);
    const target = await this.repo.getActiveAssignmentFor(
      applicationId,
      consultantId,
    );
    if (!target)
      throw new NotFoundException(
        'consultant is not actively assigned to this application',
      );
    if (target.role === 'primary')
      throw new BadRequestException('consultant is already the primary');

    const currentPrimary = await this.repo.getActivePrimary(applicationId);
    if (currentPrimary && currentPrimary.consultant_id !== consultantId) {
      await this.repo.setRole(
        applicationId,
        currentPrimary.consultant_id,
        'backup',
      );
    }
    await this.repo.setRole(applicationId, consultantId, 'primary');

    await this.emit(applicationId, 'CONSULTANT_PROMOTED', {
      actorId: adminId,
      actorRole: 'admin',
      previousConsultantId: currentPrimary?.consultant_id ?? null,
      newConsultantId: consultantId,
    });
    this.bus.emit({
      type: 'APPLICATION_PROMOTED',
      application_id: applicationId,
      destination_country: app.destination_country,
      previous_consultant_id: currentPrimary?.consultant_id ?? null,
      new_consultant_id: consultantId,
    });
  }

  /** Admin removes an active BACKUP (not the primary — use unassign/reassign for that). */
  async adminRemoveBackup(
    applicationId: string,
    consultantId: string,
    adminId: string,
  ): Promise<void> {
    const app = await this.loadApp(applicationId);
    const target = await this.repo.getActiveAssignmentFor(
      applicationId,
      consultantId,
    );
    if (!target)
      throw new NotFoundException(
        'consultant is not actively assigned to this application',
      );
    if (target.role === 'primary') {
      throw new BadRequestException(
        'cannot remove the primary via remove-backup; use unassign or reassign',
      );
    }
    await this.repo.releaseAssignment(applicationId, consultantId);
    await this.emit(applicationId, 'CONSULTANT_BACKUP_REMOVED', {
      actorId: adminId,
      actorRole: 'admin',
      previousConsultantId: consultantId,
      newConsultantId: null,
    });
    this.bus.emit({
      type: 'APPLICATION_BACKUP_REMOVED',
      application_id: applicationId,
      destination_country: app.destination_country,
      previous_consultant_id: consultantId,
      new_consultant_id: null,
    });
  }

  // ---- SLA: review deadline + completion + expiry ----------------------

  /**
   * Admin overrides the review window for an application's active PRIMARY
   * assignment: due_at = now + `hours`. Validates bounds; 404 if unassigned.
   * Emits CONSULTANT_DEADLINE_CHANGED.
   */
  async setDeadline(
    applicationId: string,
    hours: number,
    adminId: string,
  ): Promise<{ due_at: string }> {
    if (
      !Number.isFinite(hours) ||
      hours < MIN_REVIEW_HOURS ||
      hours > MAX_REVIEW_HOURS
    ) {
      throw new BadRequestException(
        `hours must be between ${MIN_REVIEW_HOURS} and ${MAX_REVIEW_HOURS}`,
      );
    }
    await this.loadApp(applicationId);
    const active = await this.repo.getActivePrimary(applicationId);
    if (!active)
      throw new NotFoundException(
        'application has no active consultant to set a deadline for',
      );
    const dueAt = this.dueAtFromNow(hours);
    await this.repo.setDeadline(applicationId, active.consultant_id, dueAt);
    await this.emit(applicationId, 'CONSULTANT_DEADLINE_CHANGED', {
      actorId: adminId,
      actorRole: 'admin',
      previousConsultantId: active.consultant_id,
      newConsultantId: active.consultant_id,
    });
    return { due_at: dueAt };
  }

  /**
   * Admin overrides the review deadline with an ABSOLUTE datetime. `dueAt` must
   * parse and fall in (now+5min, now+1year), else 400. 404 if the application
   * has no active PRIMARY. Stores the canonical ISO and emits
   * CONSULTANT_DEADLINE_CHANGED. Sibling to setDeadline(hours).
   */
  async setDeadlineAt(
    applicationId: string,
    dueAt: string,
    adminId: string,
  ): Promise<{ due_at: string }> {
    const ts = Date.parse(dueAt);
    if (Number.isNaN(ts)) {
      throw new BadRequestException('dueAt is not a valid datetime');
    }
    const now = Date.now();
    if (ts < now + MIN_DEADLINE_LEAD_MS) {
      throw new BadRequestException(
        'dueAt must be at least 5 minutes in the future',
      );
    }
    if (ts > now + MAX_DEADLINE_HORIZON_MS) {
      throw new BadRequestException('dueAt must be within 1 year');
    }
    await this.loadApp(applicationId);
    const active = await this.repo.getActivePrimary(applicationId);
    if (!active)
      throw new NotFoundException(
        'application has no active consultant to set a deadline for',
      );
    // Canonicalize to ISO (handles offset strings consistently with hours path).
    const canonical = new Date(ts).toISOString();
    await this.repo.setDeadline(applicationId, active.consultant_id, canonical);
    await this.emit(applicationId, 'CONSULTANT_DEADLINE_CHANGED', {
      actorId: adminId,
      actorRole: 'admin',
      previousConsultantId: active.consultant_id,
      newConsultantId: active.consultant_id,
    });
    return { due_at: canonical };
  }

  /**
   * The assigned consultant marks their review complete — stops the SLA clock
   * so the assignment is no longer swept back to the queue. Any active assignee
   * (primary or backup) may complete. Emits CONSULTANT_COMPLETED.
   */
  async markComplete(
    applicationId: string,
    consultantId: string,
  ): Promise<{ completed_at: string }> {
    const active = await this.repo.getActiveAssignmentFor(
      applicationId,
      consultantId,
    );
    if (!active)
      throw new ForbiddenException(
        'you are not actively assigned to this application',
      );
    const completedAt = new Date().toISOString();
    await this.repo.markCompleted(applicationId, consultantId, completedAt);
    await this.emit(applicationId, 'CONSULTANT_COMPLETED', {
      actorId: consultantId,
      actorRole: 'consultant',
      previousConsultantId: consultantId,
      newConsultantId: consultantId,
    });
    // Analytics: no application-owner lookup here (would add a DB read to this
    // path purely for a rollup dimension) — user_id is null; application_id +
    // consultant_id are sufficient to join back to the owner downstream.
    this.analytics?.emitSafe(
      makeServerEvent('review.completed', {
        application_id: applicationId,
        props: { consultant_id: consultantId, role: active.role ?? null },
      }),
    );
    return { completed_at: completedAt };
  }

  /**
   * SLA expiry sweep: release every active, not-completed, past-due assignment.
   * Each released app returns to the UNASSIGNED queue (CONSULTANT_ASSIGNMENT_
   * EXPIRED audit + APPLICATION_UNASSIGNED bus event for live refresh). Run lazily
   * on portal reads. Returns the number released.
   */
  async releaseExpired(): Promise<number> {
    const now = new Date().toISOString();
    const expired = await this.repo.releaseExpired(now);
    for (const e of expired) {
      await this.emit(e.application_id, 'CONSULTANT_ASSIGNMENT_EXPIRED', {
        actorId: null,
        actorRole: 'system',
        previousConsultantId: e.consultant_id,
        newConsultantId: null,
      });
      this.bus.emit({
        type: 'APPLICATION_UNASSIGNED',
        application_id: e.application_id,
        destination_country: e.destination_country,
        previous_consultant_id: e.consultant_id,
        new_consultant_id: null,
      });
    }
    return expired.length;
  }

  // ---- internals -------------------------------------------------------

  /** Assignment metadata stamped at (re)insert: who + a fresh default deadline. */
  private meta(
    assignedBy: string,
    assignedByRole: 'consultant' | 'admin',
  ): AssignmentMeta {
    return {
      assignedBy,
      assignedByRole,
      dueAt: this.dueAtFromNow(DEFAULT_REVIEW_HOURS),
    };
  }

  private dueAtFromNow(hours: number): string {
    return new Date(Date.now() + hours * 3_600_000).toISOString();
  }

  private async insertOrConflict(
    applicationId: string,
    consultantId: string,
    role: import('@visaai/types').AssignmentRole = 'primary',
    meta?: AssignmentMeta,
  ): Promise<ConsultantAssignment> {
    try {
      return await this.repo.insertAssignment(
        applicationId,
        consultantId,
        role,
        meta,
      );
    } catch (err) {
      if (err instanceof AssignmentConflictError) {
        throw new ConflictException(err.message);
      }
      throw err;
    }
  }

  private async loadApp(applicationId: string): Promise<ApplicationMeta> {
    const app = await this.repo.getApplicationMeta(applicationId);
    if (!app) throw new NotFoundException('application not found');
    return app;
  }

  /**
   * System-initiated consultant escalation (e.g. VRI auto-escalate-on-low-score).
   * Actor-less by design — no human assigner. Records a durable audit event so
   * the escalation is traceable; the `applications.needs_consultant_escalation`
   * flag (set by the VRI save node) remains the queue-facing contract. Does NOT
   * force-assign a specific consultant — the flagged app surfaces in the existing
   * country-eligible unassigned queue for pickup.
   */
  async flagForConsultantEscalation(
    applicationId: string,
    reason: string | null = null,
  ): Promise<void> {
    await this.audit.append({
      applicationId,
      eventType: 'CONSULTANT_ESCALATION_FLAGGED',
      actor: { id: null, role: 'system' },
      payload: {
        reason,
        previous_consultant_id: null,
        new_consultant_id: null,
      },
    });
    // Analytics: system-initiated AI escalation (e.g. VRI auto-escalate-on-low-
    // score). Non-PII only — the free-text `reason` is NEVER put in props; we emit
    // only a boolean presence flag so the escalation is countable without leaking
    // the reason string. No score/enum is available in this method's scope.
    this.analytics?.emitSafe(
      makeServerEvent('ai.escalated', {
        application_id: applicationId,
        props: { reason_present: reason != null },
      }),
    );
  }

  private emit(
    applicationId: string,
    eventType: AuditEventType,
    p: {
      actorId: string | null;
      actorRole: 'consultant' | 'admin' | 'system';
      previousConsultantId: string | null;
      newConsultantId: string | null;
    },
  ) {
    return this.audit.append({
      applicationId,
      eventType,
      actor: { id: p.actorId, role: p.actorRole },
      payload: {
        previous_consultant_id: p.previousConsultantId,
        new_consultant_id: p.newConsultantId,
        actor_id: p.actorId,
      },
    });
  }
}

/**
 * A consultant never reviews their own application: the pre-submission lock
 * exists so a second person checks what the Portal Assistant will write to a
 * government portal. Live 2026-10-20: the admin Assign button's default pick
 * was the applicant's own (consultant-role) account, which could then lock
 * and approve its own application.
 */
function notOwnApplication(app: ApplicationMeta, consultantId: string): void {
  if (app.user_id && app.user_id === consultantId) {
    throw new ForbiddenException(
      'a consultant cannot be assigned to their own application',
    );
  }
}
