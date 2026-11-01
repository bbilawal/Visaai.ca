import { Injectable } from '@nestjs/common';
import type {
  AdminApplicationView,
  ApplicantApplicationView,
  AssignedConsultant,
  AssignmentRole,
  AssignmentStatus,
  ConsultantApproval,
  ConsultantAssignment,
  ConsultantDecisionInput,
  ConsultantQueueItem,
} from '@visaai/types';
import { ConsultantWriteClient } from './consultant-write-client';
import {
  type AssignedApplication,
  type IConsultantRepository,
} from './consultant.repository';
import {
  AssignmentConflictError,
  type AdminApplicationFilter,
  type ApplicationMeta,
  type AssignmentMeta,
  type ConsultantCountryRow,
  type ExpiredAssignment,
  type IAssignmentRepository,
} from './assignment.repository';
import { expandCoveredCodes } from '../../strategies';

/** Shape of an embedded applications row (with optional framework visa_type). */
interface AppEmbed {
  id: string;
  user_id?: string | null;
  destination_country: string | null;
  status: string | null;
  created_at: string | null;
  country_frameworks?: { visa_type: string | null } | null;
  visa_types?: VisaTypeEmbed;
}

type VisaTypeEmbed =
  | { official_name: string | null }
  | { official_name: string | null }[]
  | null;

/**
 * The application's visa type label. Registry-era applications carry their
 * route as `visa_type_id` → `visa_types` and never set `framework_id`, so
 * reading only `country_frameworks.visa_type` showed "visa TBD" for an
 * application with TRV set (dry run 2026-10-14, #37). Registry first, legacy
 * framework as the fallback.
 */
function visaTypeLabel(a: {
  country_frameworks?: { visa_type: string | null } | null;
  visa_types?: VisaTypeEmbed;
}): string | null {
  const vt = Array.isArray(a.visa_types) ? a.visa_types[0] : a.visa_types;
  return vt?.official_name ?? a.country_frameworks?.visa_type ?? null;
}

/** Shape of an embedded consultant_assignments row hung off an application. */
interface AsgEmbed {
  consultant_id: string;
  assigned_at: string;
  status: string;
  role: AssignmentRole | null;
  assigned_by: string | null;
  assigned_by_role: 'consultant' | 'admin' | null;
  due_at: string | null;
  completed_at: string | null;
}

/**
 * Supabase-backed IConsultantRepository (consultant_assignments +
 * consultant_approvals). Decisions are append-style (a new row per decision).
 * Assignment/authorization VALIDATION lives in ConsultantApprovalService.
 *
 * All table access goes through ConsultantWriteClient (the service-role ->
 * RLS-safe seam) — the repository never touches `supabase.admin` directly.
 * No constructor side effects.
 */
@Injectable()
export class ConsultantRepository
  implements IConsultantRepository, IAssignmentRepository
{
  constructor(private readonly writes: ConsultantWriteClient) {}

  async insertAssignment(
    applicationId: string,
    consultantId: string,
    role: AssignmentRole = 'primary',
    meta?: AssignmentMeta,
  ): Promise<ConsultantAssignment> {
    // Upsert on (application_id, consultant_id) so re-activating a previously
    // released consultant (reassign cycling A->B->A) succeeds. The partial
    // unique index (one ACTIVE PRIMARY per application) still fires 23505 if a
    // DIFFERENT primary consultant is currently active — that is the race/conflict boundary.
    //
    // SLA fields are set EXPLICITLY (not via the column default) because re-
    // activating a released row is an UPDATE — the default only fires on INSERT.
    // Every (re)assignment therefore gets a fresh deadline + a cleared
    // completed_at, never an inherited one from a prior tenure.
    const row: Record<string, unknown> = {
      application_id: applicationId,
      consultant_id: consultantId,
      role,
      status: 'active',
      released_at: null,
    };
    if (meta) {
      row.due_at = meta.dueAt;
      row.completed_at = null;
      row.assigned_by = meta.assignedBy;
      row.assigned_by_role = meta.assignedByRole;
    }
    const { data, error } = await this.writes.client
      .from('consultant_assignments')
      .upsert(row, { onConflict: 'application_id,consultant_id' })
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505') throw new AssignmentConflictError();
      throw new Error(`insertAssignment failed: ${error.message}`);
    }
    if (!data) throw new Error('insertAssignment failed: no row');
    return data;
  }

  async setDeadline(
    applicationId: string,
    consultantId: string,
    dueAt: string,
  ): Promise<void> {
    const { data, error } = await this.writes.client
      .from('consultant_assignments')
      .update({ due_at: dueAt })
      .eq('application_id', applicationId)
      .eq('consultant_id', consultantId)
      .eq('status', 'active')
      .select('id');
    if (error) throw new Error(`setDeadline failed: ${error.message}`);
    if (!data || data.length === 0) {
      throw new Error(
        `setDeadline: no active assignment for consultant ${consultantId} on ${applicationId}`,
      );
    }
  }

  async markCompleted(
    applicationId: string,
    consultantId: string,
    completedAt: string,
  ): Promise<void> {
    const { data, error } = await this.writes.client
      .from('consultant_assignments')
      .update({ completed_at: completedAt })
      .eq('application_id', applicationId)
      .eq('consultant_id', consultantId)
      .eq('status', 'active')
      .select('id');
    if (error) throw new Error(`markCompleted failed: ${error.message}`);
    if (!data || data.length === 0) {
      throw new Error(
        `markCompleted: no active assignment for consultant ${consultantId} on ${applicationId}`,
      );
    }
  }

  async releaseExpired(now: string): Promise<ExpiredAssignment[]> {
    // Find active, not-completed, past-due assignments (covered by the partial
    // sweep index). Embed destination_country for the queue/audit events.
    const { data, error } = await this.writes.client
      .from('consultant_assignments')
      .select(
        'id, application_id, consultant_id, applications(destination_country)',
      )
      .eq('status', 'active')
      .is('completed_at', null)
      .lt('due_at', now);
    if (error)
      throw new Error(`releaseExpired select failed: ${error.message}`);

    type Row = {
      id: string;
      application_id: string;
      consultant_id: string;
      applications: { destination_country: string | null } | null;
    };
    const rows = (data ?? []) as unknown as Row[];
    if (rows.length === 0) return [];

    const { error: upErr } = await this.writes.client
      .from('consultant_assignments')
      .update({ status: 'released', released_at: now })
      .in(
        'id',
        rows.map((r) => r.id),
      );
    if (upErr)
      throw new Error(`releaseExpired update failed: ${upErr.message}`);

    return rows.map((r) => ({
      application_id: r.application_id,
      consultant_id: r.consultant_id,
      destination_country: r.applications?.destination_country ?? null,
    }));
  }

  async releaseAssignment(
    applicationId: string,
    consultantId: string,
  ): Promise<void> {
    const { error } = await this.writes.client
      .from('consultant_assignments')
      .update({ status: 'released', released_at: new Date().toISOString() })
      .eq('application_id', applicationId)
      .eq('consultant_id', consultantId)
      .eq('status', 'active');
    if (error) throw new Error(`releaseAssignment failed: ${error.message}`);
  }

  async getActivePrimary(
    applicationId: string,
  ): Promise<ConsultantAssignment | null> {
    const { data, error } = await this.writes.client
      .from('consultant_assignments')
      .select('*')
      .eq('application_id', applicationId)
      .eq('status', 'active')
      .eq('role', 'primary')
      .maybeSingle();
    if (error) throw new Error(`getActivePrimary failed: ${error.message}`);
    return data ?? null;
  }

  async listActiveAssignments(
    applicationId: string,
  ): Promise<ConsultantAssignment[]> {
    const { data, error } = await this.writes.client
      .from('consultant_assignments')
      .select('*')
      .eq('application_id', applicationId)
      .eq('status', 'active')
      .order('assigned_at', { ascending: true });
    if (error)
      throw new Error(`listActiveAssignments failed: ${error.message}`);
    return data ?? [];
  }

  async getActiveAssignmentFor(
    applicationId: string,
    consultantId: string,
  ): Promise<ConsultantAssignment | null> {
    const { data, error } = await this.writes.client
      .from('consultant_assignments')
      .select('*')
      .eq('application_id', applicationId)
      .eq('consultant_id', consultantId)
      .eq('status', 'active')
      .maybeSingle();
    if (error)
      throw new Error(`getActiveAssignmentFor failed: ${error.message}`);
    return data ?? null;
  }

  async setRole(
    applicationId: string,
    consultantId: string,
    role: AssignmentRole,
  ): Promise<void> {
    const { data, error } = await this.writes.client
      .from('consultant_assignments')
      .update({ role })
      .eq('application_id', applicationId)
      .eq('consultant_id', consultantId)
      .eq('status', 'active')
      .select('id');
    if (error) throw new Error(`setRole failed: ${error.message}`);
    // Guard against a silent no-op (active row released concurrently) — a
    // promote/demote that changed nothing must not look like success.
    if (!data || data.length === 0) {
      throw new Error(
        `setRole: no active assignment for consultant ${consultantId} on ${applicationId}`,
      );
    }
  }

  async listAssignments(
    applicationId: string,
  ): Promise<ConsultantAssignment[]> {
    const { data, error } = await this.writes.client
      .from('consultant_assignments')
      .select('*')
      .eq('application_id', applicationId)
      .order('assigned_at', { ascending: true });
    if (error) throw new Error(`listAssignments failed: ${error.message}`);
    return data ?? [];
  }

  async insertDecision(
    input: ConsultantDecisionInput,
  ): Promise<ConsultantApproval> {
    const { data, error } = await this.writes.client
      .from('consultant_approvals')
      .insert({
        application_id: input.applicationId,
        consultant_id: input.consultantId,
        scope: input.scope,
        field_key: input.fieldKey ?? null,
        section: input.section ?? null,
        decision: input.decision,
        value_hash: input.valueHash ?? null,
        reason: input.reason ?? null,
      })
      .select('*')
      .single();
    if (error || !data)
      throw new Error(`insertDecision failed: ${error?.message ?? 'no row'}`);
    return data;
  }

  async listDecisions(applicationId: string): Promise<ConsultantApproval[]> {
    const { data, error } = await this.writes.client
      .from('consultant_approvals')
      .select('*')
      .eq('application_id', applicationId)
      .order('decided_at', { ascending: false });
    if (error) throw new Error(`listDecisions failed: ${error.message}`);
    return data ?? [];
  }

  async listAssignedApplications(
    consultantId: string,
  ): Promise<AssignedApplication[]> {
    // `visa_type` lives on country_frameworks, reached via applications.framework_id —
    // the applications table itself has no such column.
    const { data, error } = await this.writes.client
      .from('consultant_assignments')
      .select(
        'applications(id, status, created_at, country_frameworks(visa_type), visa_types(official_name))',
      )
      .eq('consultant_id', consultantId)
      .eq('status', 'active');
    if (error)
      throw new Error(`listAssignedApplications failed: ${error.message}`);
    type Row = {
      applications: {
        id: string;
        status: string | null;
        created_at: string | null;
        country_frameworks: { visa_type: string | null } | null;
        visa_types?: VisaTypeEmbed;
      } | null;
    };
    return ((data ?? []) as unknown as Row[])
      .map((row) => row.applications)
      .filter((a): a is NonNullable<Row['applications']> => !!a)
      .map((a) => ({
        id: a.id,
        visa_type: visaTypeLabel(a),
        status: a.status,
        created_at: a.created_at,
      }));
  }

  // ---- country-scoped visibility + assignment views --------------------

  async getConsultantCountries(consultantId: string): Promise<string[]> {
    const { data, error } = await this.writes.client
      .from('consultant_countries')
      .select('country_code')
      .eq('consultant_id', consultantId)
      .eq('active', true);
    if (error)
      throw new Error(`getConsultantCountries failed: ${error.message}`);
    return ((data ?? []) as { country_code: string }[]).map(
      (r) => r.country_code,
    );
  }

  async listConsultantCountryRows(
    consultantId: string,
  ): Promise<ConsultantCountryRow[]> {
    const { data, error } = await this.writes.client
      .from('consultant_countries')
      .select('country_code, active')
      .eq('consultant_id', consultantId);
    if (error)
      throw new Error(`listConsultantCountryRows failed: ${error.message}`);
    return data ?? [];
  }

  async setConsultantCountries(
    consultantId: string,
    codes: string[],
  ): Promise<void> {
    // 1) Upsert active=true for every requested code (insert new pairs or
    //    re-activate previously deactivated ones). onConflict matches the
    //    unique(consultant_id, country_code) index.
    if (codes.length > 0) {
      const rows = codes.map((country_code) => ({
        consultant_id: consultantId,
        country_code,
        active: true,
      }));
      const { error: upErr } = await this.writes.client
        .from('consultant_countries')
        .upsert(rows, { onConflict: 'consultant_id,country_code' });
      if (upErr)
        throw new Error(
          `setConsultantCountries upsert failed: ${upErr.message}`,
        );
    }

    // 2) Deactivate every other active row this consultant has (codes removed
    //    from the set). `.not('country_code','in', ...)` excludes the keepers;
    //    when codes is empty, deactivate all active rows.
    let deact = this.writes.client
      .from('consultant_countries')
      .update({ active: false })
      .eq('consultant_id', consultantId)
      .eq('active', true);
    if (codes.length > 0) {
      deact = deact.not('country_code', 'in', `(${codes.join(',')})`);
    }
    const { error: deErr } = await deact;
    if (deErr)
      throw new Error(
        `setConsultantCountries deactivate failed: ${deErr.message}`,
      );
  }

  async getApplicationMeta(
    applicationId: string,
  ): Promise<ApplicationMeta | null> {
    const { data, error } = await this.writes.client
      .from('applications')
      .select('id, user_id, destination_country')
      .eq('id', applicationId)
      .maybeSingle();
    if (error) throw new Error(`getApplicationMeta failed: ${error.message}`);
    return data ?? null;
  }

  /** Application ids that currently have an ACTIVE assignment. */
  private async activeAssignedAppIds(): Promise<Set<string>> {
    const { data, error } = await this.writes.client
      .from('consultant_assignments')
      .select('application_id')
      .eq('status', 'active');
    if (error) throw new Error(`activeAssignedAppIds failed: ${error.message}`);
    return new Set(
      ((data ?? []) as { application_id: string }[]).map(
        (r) => r.application_id,
      ),
    );
  }

  async listUnassignedByCountries(
    countryCodes: string[],
  ): Promise<ConsultantQueueItem[]> {
    if (countryCodes.length === 0) return [];
    // Bloc-expansion (mirrors the SQL consultant_covers_country rule): a
    // consultant covering 'SCHENGEN' must see all 27 member-coded apps too.
    const expanded = expandCoveredCodes(countryCodes);
    const { data, error } = await this.writes.client
      .from('applications')
      .select(
        'id, destination_country, status, created_at, country_frameworks(visa_type), visa_types(official_name)',
      )
      .in('destination_country', expanded)
      .order('created_at', { ascending: false });
    if (error)
      throw new Error(`listUnassignedByCountries failed: ${error.message}`);
    const assigned = await this.activeAssignedAppIds();
    return ((data ?? []) as unknown as AppEmbed[])
      .filter((a) => !assigned.has(a.id)) // derived UNASSIGNED only
      .map((a) => this.toQueueItem(a, 'UNASSIGNED'));
  }

  async listMyAssignedApplications(
    consultantId: string,
  ): Promise<ConsultantQueueItem[]> {
    const { data, error } = await this.writes.client
      .from('consultant_assignments')
      .select(
        'due_at, completed_at, applications(id, destination_country, status, created_at, country_frameworks(visa_type), visa_types(official_name))',
      )
      .eq('consultant_id', consultantId)
      .eq('status', 'active');
    if (error)
      throw new Error(`listMyAssignedApplications failed: ${error.message}`);
    type Row = {
      due_at: string | null;
      completed_at: string | null;
      applications: AppEmbed | null;
    };
    return ((data ?? []) as unknown as Row[])
      .filter((r): r is Row & { applications: AppEmbed } => !!r.applications)
      .map((r) =>
        this.toQueueItem(r.applications, 'ASSIGNED', r.due_at, r.completed_at),
      );
  }

  async getAssignedConsultant(
    applicationId: string,
  ): Promise<AssignedConsultant | null> {
    const { data, error } = await this.writes.client
      .from('consultant_assignments')
      .select(
        'consultant_id, assigned_at, assigned_by, assigned_by_role, due_at, completed_at, role',
      )
      .eq('application_id', applicationId)
      .eq('status', 'active')
      .eq('role', 'primary')
      .maybeSingle();
    if (error)
      throw new Error(`getAssignedConsultant failed: ${error.message}`);
    if (!data) return null;
    const row = data as {
      consultant_id: string;
      assigned_at: string;
      assigned_by: string | null;
      assigned_by_role: 'consultant' | 'admin' | null;
      due_at: string | null;
      completed_at: string | null;
    };
    const emails = await this.emailsByIds(
      [row.consultant_id, row.assigned_by].filter((id): id is string => !!id),
    );
    return {
      id: row.consultant_id,
      email: emails.get(row.consultant_id) ?? null,
      assigned_at: row.assigned_at,
      due_at: row.due_at ?? null,
      completed_at: row.completed_at ?? null,
      assigned_by_role: row.assigned_by_role ?? null,
      assigned_by_email: row.assigned_by
        ? (emails.get(row.assigned_by) ?? null)
        : null,
    };
  }

  async listAllApplicationsAdmin(
    filter?: AdminApplicationFilter,
  ): Promise<AdminApplicationView[]> {
    let q = this.writes.client
      .from('applications')
      .select(
        'id, user_id, destination_country, status, created_at, consultant_assignments(consultant_id, assigned_at, status, role, assigned_by, assigned_by_role, due_at, completed_at)',
      )
      .order('created_at', { ascending: false });
    if (filter?.status) q = q.eq('status', filter.status);
    if (filter?.country) q = q.eq('destination_country', filter.country);
    // Free-text id match → PostgREST ilike (substring, case-insensitive).
    if (filter?.q) q = q.ilike('id', `%${filter.q}%`);
    const { data, error } = await q;
    if (error)
      throw new Error(`listAllApplicationsAdmin failed: ${error.message}`);

    type Row = AppEmbed & { consultant_assignments?: AsgEmbed[] | null };
    const rows = (data ?? []) as unknown as Row[];

    const emails = await this.emailsByIds(
      rows.flatMap((r) => {
        const a = this.activeAssignee(r.consultant_assignments);
        return a ? [a.consultant_id, a.assigned_by] : [];
      }),
    );

    // Server-side (JS) predicates — bounded volume; contract permits moving to
    // an RPC/view later. assignee email substring, derived assignmentStatus,
    // and active-assignee due_at range all AND together.
    const assignee = filter?.assignee?.toLowerCase();
    const from = filter?.deadlineFrom;
    const to = filter?.deadlineTo;

    return rows
      .map((r) => {
        const active = this.activeAssignee(r.consultant_assignments);
        return { r, active };
      })
      .filter(({ active }) => {
        const status: AssignmentStatus = active ? 'ASSIGNED' : 'UNASSIGNED';
        if (filter?.assignmentStatus && status !== filter.assignmentStatus) {
          return false;
        }
        if (assignee) {
          const email = active
            ? (emails.get(active.consultant_id) ?? '').toLowerCase()
            : '';
          if (!email.includes(assignee)) return false;
        }
        if (from || to) {
          // Range applies to the active assignee's due_at; unassigned or
          // deadline-less rows never match a date constraint.
          const dueAt = active?.due_at ?? null;
          if (!dueAt) return false;
          if (from && dueAt < from) return false;
          if (to && dueAt > to) return false;
        }
        return true;
      })
      .map(({ r, active }) => ({
        id: r.id,
        user_id: r.user_id ?? '',
        destination_country: r.destination_country,
        status: r.status,
        assignment_status: active ? 'ASSIGNED' : 'UNASSIGNED',
        assigned_consultant: active
          ? this.toAssignedConsultant(active, emails)
          : null,
        created_at: r.created_at,
      }));
  }

  async listApplicantApplications(
    userId: string,
  ): Promise<ApplicantApplicationView[]> {
    const { data, error } = await this.writes.client
      .from('applications')
      .select(
        'id, destination_country, status, created_at, consultant_assignments(consultant_id, assigned_at, status, role, assigned_by, assigned_by_role, due_at, completed_at)',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error)
      throw new Error(`listApplicantApplications failed: ${error.message}`);

    type Row = AppEmbed & { consultant_assignments?: AsgEmbed[] | null };
    const rows = (data ?? []) as unknown as Row[];
    const emails = await this.emailsByIds(
      rows.flatMap((r) => {
        const a = this.activeAssignee(r.consultant_assignments);
        return a ? [a.consultant_id, a.assigned_by] : [];
      }),
    );

    return rows.map((r) => {
      const active = this.activeAssignee(r.consultant_assignments);
      return {
        id: r.id,
        destination_country: r.destination_country,
        status: r.status,
        assignment_status: active ? 'ASSIGNED' : 'UNASSIGNED',
        assigned_consultant: active
          ? this.toAssignedConsultant(active, emails)
          : null,
        created_at: r.created_at,
      };
    });
  }

  /**
   * The active PRIMARY assignee embed for an application (or null). Backups are
   * active too, but the "assigned consultant" surfaced to admin/applicant is the
   * owner. Falls back to any active row if no explicit primary (legacy rows).
   */
  private activeAssignee(assignments?: AsgEmbed[] | null): AsgEmbed | null {
    const active = (assignments ?? []).filter((a) => a.status === 'active');
    return active.find((a) => a.role === 'primary') ?? active[0] ?? null;
  }

  /** Build the AssignedConsultant view from an active embed + a resolved email map. */
  private toAssignedConsultant(
    a: AsgEmbed,
    emails: Map<string, string | null>,
  ): AssignedConsultant {
    return {
      id: a.consultant_id,
      email: emails.get(a.consultant_id) ?? null,
      assigned_at: a.assigned_at,
      due_at: a.due_at ?? null,
      completed_at: a.completed_at ?? null,
      assigned_by_role: a.assigned_by_role ?? null,
      assigned_by_email: a.assigned_by
        ? (emails.get(a.assigned_by) ?? null)
        : null,
    };
  }

  /** Public batch id->email lookup (IAssignmentRepository). */
  getUserEmails(ids: string[]): Promise<Map<string, string | null>> {
    return this.emailsByIds(ids);
  }

  /** Batch id->email lookup (deduped, null/undefined-tolerant). Empty -> empty map. */
  private async emailsByIds(
    ids: (string | null | undefined)[],
  ): Promise<Map<string, string | null>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (unique.length === 0) return new Map();
    const { data, error } = await this.writes.client
      .from('users')
      .select('id, email')
      .in('id', unique);
    if (error) throw new Error(`emailsByIds failed: ${error.message}`);
    const m = new Map<string, string | null>();
    for (const u of (data ?? []) as { id: string; email: string | null }[]) {
      m.set(u.id, u.email ?? null);
    }
    return m;
  }

  private toQueueItem(
    a: AppEmbed,
    status: AssignmentStatus,
    dueAt: string | null = null,
    completedAt: string | null = null,
  ): ConsultantQueueItem {
    return {
      id: a.id,
      destination_country: a.destination_country,
      status: a.status,
      assignment_status: status,
      visa_type: visaTypeLabel(a),
      created_at: a.created_at,
      due_at: dueAt,
      completed_at: completedAt,
    };
  }
}
