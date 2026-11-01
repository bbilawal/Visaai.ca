import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type {
  AdminApplicationView,
  ApplicantApplicationView,
  AssignedConsultant,
  AssignmentRole,
  ConsultantAssignment,
  ConsultantQueueItem,
} from '@visaai/types';
import { AuditService } from '../src/modules/audit/audit.service';
import { AssignmentService } from '../src/modules/consultant/assignment.service';
import {
  AssignmentEventBus,
  type AssignmentBusEvent,
} from '../src/modules/event-bus/assignment-event-bus';
import {
  AssignmentConflictError,
  type ApplicationMeta,
  type AssignmentMeta,
  type ExpiredAssignment,
  type IAssignmentRepository,
} from '../src/modules/consultant/assignment.repository';
import { consultantCoversCountry, expandCoveredCodes } from '../src/strategies';
import { FakeAuditRepository } from './fakes/audit-repository.fake';

// ---- fakes ----------------------------------------------------------------

interface AppRow {
  id: string;
  user_id: string;
  destination_country: string | null;
  status: string | null;
  created_at: string | null;
}

class FakeAssignmentRepository implements IAssignmentRepository {
  apps: AppRow[] = [];
  assignments: ConsultantAssignment[] = [];
  countries = new Map<string, { code: string; active: boolean }[]>();
  emails = new Map<string, string>();
  private a = 0;
  private clock = 0;
  private ts() {
    return new Date(1_700_000_000_000 + ++this.clock * 1000).toISOString();
  }

  // --- seed helpers ---
  addApp(row: Partial<AppRow> & { id: string; user_id: string }) {
    this.apps.push({
      destination_country: null,
      status: 'draft',
      created_at: this.ts(),
      ...row,
    });
  }
  mapCountry(consultantId: string, code: string, active = true) {
    const list = this.countries.get(consultantId) ?? [];
    list.push({ code, active });
    this.countries.set(consultantId, list);
  }

  private activeFor(appId: string): ConsultantAssignment | undefined {
    return this.assignments.find(
      (x) => x.application_id === appId && x.status === 'active',
    );
  }

  async insertAssignment(
    applicationId: string,
    consultantId: string,
    role: AssignmentRole = 'primary',
    meta?: AssignmentMeta,
  ): Promise<ConsultantAssignment> {
    // Mirror the real partial unique index: conflict only on a 2nd active PRIMARY
    // for a DIFFERENT consultant. Backups never conflict on the primary index.
    if (role === 'primary') {
      const activePrimary = this.assignments.find(
        (x) =>
          x.application_id === applicationId &&
          x.status === 'active' &&
          x.role === 'primary',
      );
      if (activePrimary && activePrimary.consultant_id !== consultantId) {
        throw new AssignmentConflictError(); // 23505 on one_active_primary_uidx
      }
    }
    // upsert on (app, consultant): reactivate a released row if present
    const existing = this.assignments.find(
      (x) =>
        x.application_id === applicationId && x.consultant_id === consultantId,
    );
    // Mirror the real impl: SLA fields set explicitly on every (re)insert
    // (default 24h ahead when no meta — like the DB column default).
    const dueAt =
      meta?.dueAt ?? new Date(Date.now() + 24 * 3_600_000).toISOString();
    if (existing) {
      existing.status = 'active';
      existing.released_at = null;
      existing.assigned_at = this.ts();
      existing.role = role;
      existing.due_at = dueAt;
      existing.completed_at = null;
      existing.assigned_by = meta?.assignedBy ?? null;
      existing.assigned_by_role = meta?.assignedByRole ?? null;
      return existing;
    }
    const row: ConsultantAssignment = {
      id: `asg-${++this.a}`,
      application_id: applicationId,
      consultant_id: consultantId,
      role,
      status: 'active',
      assigned_at: this.ts(),
      released_at: null,
      due_at: dueAt,
      completed_at: null,
      assigned_by: meta?.assignedBy ?? null,
      assigned_by_role: meta?.assignedByRole ?? null,
    };
    this.assignments.push(row);
    return row;
  }

  async setDeadline(
    applicationId: string,
    consultantId: string,
    dueAt: string,
  ): Promise<void> {
    const r = this.assignments.find(
      (x) =>
        x.application_id === applicationId &&
        x.consultant_id === consultantId &&
        x.status === 'active',
    );
    if (!r) throw new Error('setDeadline: no active assignment');
    r.due_at = dueAt;
  }

  async markCompleted(
    applicationId: string,
    consultantId: string,
    completedAt: string,
  ): Promise<void> {
    const r = this.assignments.find(
      (x) =>
        x.application_id === applicationId &&
        x.consultant_id === consultantId &&
        x.status === 'active',
    );
    if (!r) throw new Error('markCompleted: no active assignment');
    r.completed_at = completedAt;
  }

  async releaseExpired(now: string): Promise<ExpiredAssignment[]> {
    const expired = this.assignments.filter(
      (x) =>
        x.status === 'active' &&
        !x.completed_at &&
        x.due_at != null &&
        x.due_at < now,
    );
    for (const r of expired) {
      r.status = 'released';
      r.released_at = now;
    }
    return expired.map((r) => ({
      application_id: r.application_id,
      consultant_id: r.consultant_id,
      destination_country:
        this.apps.find((a) => a.id === r.application_id)?.destination_country ??
        null,
    }));
  }

  async releaseAssignment(applicationId: string, consultantId: string) {
    const r = this.assignments.find(
      (x) =>
        x.application_id === applicationId &&
        x.consultant_id === consultantId &&
        x.status === 'active',
    );
    if (r) {
      r.status = 'released';
      r.released_at = this.ts();
    }
  }

  async getActivePrimary(applicationId: string) {
    return (
      this.assignments.find(
        (x) =>
          x.application_id === applicationId &&
          x.status === 'active' &&
          x.role === 'primary',
      ) ?? null
    );
  }
  async getActiveAssignmentFor(applicationId: string, consultantId: string) {
    return (
      this.assignments.find(
        (x) =>
          x.application_id === applicationId &&
          x.consultant_id === consultantId &&
          x.status === 'active',
      ) ?? null
    );
  }
  async listActiveAssignments(applicationId: string) {
    return this.assignments.filter(
      (x) => x.application_id === applicationId && x.status === 'active',
    );
  }
  async setRole(
    applicationId: string,
    consultantId: string,
    role: AssignmentRole,
  ) {
    const r = this.assignments.find(
      (x) =>
        x.application_id === applicationId &&
        x.consultant_id === consultantId &&
        x.status === 'active',
    );
    if (r) r.role = role;
  }

  async getConsultantCountries(consultantId: string): Promise<string[]> {
    return (this.countries.get(consultantId) ?? [])
      .filter((c) => c.active)
      .map((c) => c.code);
  }

  async listConsultantCountryRows(
    consultantId: string,
  ): Promise<{ country_code: string; active: boolean }[]> {
    return (this.countries.get(consultantId) ?? []).map((c) => ({
      country_code: c.code,
      active: c.active,
    }));
  }

  async setConsultantCountries(
    consultantId: string,
    codes: string[],
  ): Promise<void> {
    const keep = new Set(codes);
    const existing = this.countries.get(consultantId) ?? [];
    // Deactivate rows not in `codes`; reactivate/keep those that are.
    for (const row of existing) row.active = keep.has(row.code);
    // Insert any brand-new codes as active.
    for (const code of codes) {
      if (!existing.some((r) => r.code === code)) {
        existing.push({ code, active: true });
      }
    }
    this.countries.set(consultantId, existing);
  }

  async getApplicationMeta(
    applicationId: string,
  ): Promise<ApplicationMeta | null> {
    const a = this.apps.find((x) => x.id === applicationId);
    return a
      ? {
          id: a.id,
          user_id: a.user_id,
          destination_country: a.destination_country,
        }
      : null;
  }

  async listUnassignedByCountries(
    codes: string[],
  ): Promise<ConsultantQueueItem[]> {
    if (codes.length === 0) return [];
    // Mirror the real ConsultantRepository: expand the SCHENGEN bloc before the
    // exact-match `.in(...)` so a SCHENGEN consultant sees member-coded apps.
    const expanded = expandCoveredCodes(codes);
    return this.apps
      .filter(
        (a) =>
          a.destination_country !== null &&
          expanded.includes(a.destination_country) &&
          !this.activeFor(a.id),
      )
      .map((a) => this.toItem(a, 'UNASSIGNED'));
  }

  async listMyAssignedApplications(
    consultantId: string,
  ): Promise<ConsultantQueueItem[]> {
    const ids = this.assignments
      .filter((x) => x.consultant_id === consultantId && x.status === 'active')
      .map((x) => x.application_id);
    return this.apps
      .filter((a) => ids.includes(a.id))
      .map((a) => this.toItem(a, 'ASSIGNED'));
  }

  async getAssignedConsultant(
    applicationId: string,
  ): Promise<AssignedConsultant | null> {
    const active = this.activeFor(applicationId);
    if (!active) return null;
    return this.toAssigned(active);
  }

  private toAssigned(active: ConsultantAssignment): AssignedConsultant {
    return {
      id: active.consultant_id,
      email: this.emails.get(active.consultant_id) ?? null,
      assigned_at: active.assigned_at,
      due_at: active.due_at ?? null,
      completed_at: active.completed_at ?? null,
      assigned_by_role: active.assigned_by_role ?? null,
      assigned_by_email: active.assigned_by
        ? (this.emails.get(active.assigned_by) ?? null)
        : null,
    };
  }

  async listAllApplicationsAdmin(filter?: {
    status?: string;
    country?: string;
  }): Promise<AdminApplicationView[]> {
    return this.apps
      .filter((a) => !filter?.status || a.status === filter.status)
      .filter(
        (a) => !filter?.country || a.destination_country === filter.country,
      )
      .map((a) => {
        const active = this.activeFor(a.id);
        return {
          id: a.id,
          user_id: a.user_id,
          destination_country: a.destination_country,
          status: a.status,
          assignment_status: active ? 'ASSIGNED' : 'UNASSIGNED',
          assigned_consultant: active ? this.toAssigned(active) : null,
          created_at: a.created_at,
        };
      });
  }

  async listApplicantApplications(
    userId: string,
  ): Promise<ApplicantApplicationView[]> {
    return this.apps
      .filter((a) => a.user_id === userId)
      .map((a) => {
        const active = this.activeFor(a.id);
        return {
          id: a.id,
          destination_country: a.destination_country,
          status: a.status,
          assignment_status: active ? 'ASSIGNED' : 'UNASSIGNED',
          assigned_consultant: active ? this.toAssigned(active) : null,
          created_at: a.created_at,
        };
      });
  }

  async getUserEmails(ids: string[]): Promise<Map<string, string | null>> {
    const m = new Map<string, string | null>();
    for (const i of [...new Set(ids)]) m.set(i, this.emails.get(i) ?? null);
    return m;
  }

  private toItem(
    a: AppRow,
    status: 'ASSIGNED' | 'UNASSIGNED',
  ): ConsultantQueueItem {
    return {
      id: a.id,
      destination_country: a.destination_country,
      status: a.status,
      assignment_status: status,
      visa_type: null,
      created_at: a.created_at,
      due_at: null,
      completed_at: null,
    };
  }
}

// ---- harness --------------------------------------------------------------

const ADMIN = 'admin-1';
const A = 'consA';
const B = 'consB';
const C = 'consC';

function make() {
  const repo = new FakeAssignmentRepository();
  const auditRepo = new FakeAuditRepository();
  const bus = new AssignmentEventBus();
  const busEvents: AssignmentBusEvent[] = [];
  bus.events.subscribe((e) => busEvents.push(e));
  const svc = new AssignmentService(repo, new AuditService(auditRepo), bus);
  return { svc, repo, auditRepo, busEvents };
}

function seedWorld(repo: FakeAssignmentRepository) {
  // Consultant A → CA, US ; B → AU ; C → GB(inactive GB? no, GB active)
  repo.mapCountry(A, 'CA');
  repo.mapCountry(A, 'US');
  repo.mapCountry(B, 'AU');
  repo.mapCountry(C, 'GB');
  repo.emails.set(A, 'a@x.com');
  repo.emails.set(B, 'b@x.com');
  repo.emails.set(C, 'c@x.com');
  // applications
  repo.addApp({ id: 'app-ca', user_id: 'user-1', destination_country: 'CA' });
  repo.addApp({ id: 'app-au', user_id: 'user-2', destination_country: 'AU' });
  repo.addApp({ id: 'app-gb', user_id: 'user-3', destination_country: 'GB' });
  repo.addApp({ id: 'app-null', user_id: 'user-4', destination_country: null });
}

// ---- SCENARIO 6: country filtering ---------------------------------------

describe('Assignment — country-scoped queue (SC1, SC2, SC6)', () => {
  it('consultant sees only UNASSIGNED apps for their countries', async () => {
    const { svc, repo } = make();
    seedWorld(repo);
    const a = await svc.getConsultantQueue(A); // CA, US
    expect(a.queue.map((q) => q.id)).toEqual(['app-ca']);
    const b = await svc.getConsultantQueue(B); // AU
    expect(b.queue.map((q) => q.id)).toEqual(['app-au']);
    const c = await svc.getConsultantQueue(C); // GB
    expect(c.queue.map((q) => q.id)).toEqual(['app-gb']);
  });

  it('wrong-country app is never in the queue', async () => {
    const { svc, repo } = make();
    seedWorld(repo);
    const b = await svc.getConsultantQueue(B);
    expect(b.queue.find((q) => q.id === 'app-ca')).toBeUndefined();
    expect(b.queue.find((q) => q.id === 'app-gb')).toBeUndefined();
  });

  it('multi-country consultant sees the union', async () => {
    const { svc, repo } = make();
    seedWorld(repo);
    repo.addApp({ id: 'app-us', user_id: 'user-5', destination_country: 'US' });
    const a = await svc.getConsultantQueue(A);
    expect(a.queue.map((q) => q.id).sort()).toEqual(['app-ca', 'app-us']);
  });

  it('consultant with no countries sees nothing (queue empty)', async () => {
    const { svc, repo } = make();
    seedWorld(repo);
    const none = await svc.getConsultantQueue('consNone');
    expect(none.queue).toEqual([]);
    expect(none.mine).toEqual([]);
  });

  it('inactive country mapping is excluded', async () => {
    const { svc, repo } = make();
    seedWorld(repo);
    repo.mapCountry('consInactive', 'CA', false); // inactive
    const r = await svc.getConsultantQueue('consInactive');
    expect(r.queue).toEqual([]);
  });

  it('null destination_country → admin-only (no consultant queue)', async () => {
    const { svc, repo } = make();
    seedWorld(repo);
    for (const cid of [A, B, C]) {
      const r = await svc.getConsultantQueue(cid);
      expect(r.queue.find((q) => q.id === 'app-null')).toBeUndefined();
    }
  });
});

// ---- SCENARIO 3: self-assign ---------------------------------------------

describe('Assignment — self-assign (SC3)', () => {
  it('eligible consultant self-assigns → ASSIGNED, leaves other queues, audit', async () => {
    const { svc, repo, auditRepo } = make();
    seedWorld(repo);
    const asg = await svc.selfAssign('app-ca', A);
    expect(asg).toMatchObject({
      application_id: 'app-ca',
      consultant_id: A,
      status: 'active',
    });

    // disappears from A's queue, appears in mine
    const a = await svc.getConsultantQueue(A);
    expect(a.queue.find((q) => q.id === 'app-ca')).toBeUndefined();
    expect(a.mine.map((q) => q.id)).toContain('app-ca');

    // audit: self-assigned, actor=consultant, prev null / new self
    const evt = auditRepo.rows.find(
      (e) => e.event_type === 'CONSULTANT_SELF_ASSIGNED',
    );
    expect(evt).toBeDefined();
    expect(evt!.actor_role).toBe('consultant');
    expect(evt!.payload).toMatchObject({
      previous_consultant_id: null,
      new_consultant_id: A,
    });
  });

  it('wrong-country consultant cannot self-assign (403)', async () => {
    const { svc, repo } = make();
    seedWorld(repo);
    await expect(svc.selfAssign('app-ca', B)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('null-country application cannot be self-assigned (403)', async () => {
    const { svc, repo } = make();
    seedWorld(repo);
    await expect(svc.selfAssign('app-null', A)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

// ---- SCENARIO 7: concurrency ---------------------------------------------

describe('Assignment — concurrency (SC7)', () => {
  it('second eligible consultant self-assigns → becomes a backup (P3c; primary unchanged)', async () => {
    const { svc, repo } = make();
    seedWorld(repo);
    repo.mapCountry(B, 'CA'); // make B also CA-eligible
    await svc.selfAssign('app-ca', A); // A becomes primary
    const second = await svc.selfAssign('app-ca', B); // B becomes a backup under P3c
    expect(second.role).toBe('backup');
    // exactly one active primary, still A
    const primary = await repo.getActivePrimary('app-ca');
    expect(primary!.consultant_id).toBe(A);
    // both are active assignees on the app
    const activeIds = (await repo.listActiveAssignments('app-ca'))
      .map((a) => a.consultant_id)
      .sort();
    expect(activeIds).toEqual([A, B].sort());
  });

  it('admin assigning a second PRIMARY (already owned) → 409', async () => {
    const { svc, repo } = make();
    seedWorld(repo);
    repo.mapCountry(B, 'CA');
    await svc.selfAssign('app-ca', A); // A primary
    await expect(svc.adminAssign('app-ca', B, ADMIN)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect((await repo.getActivePrimary('app-ca'))!.consultant_id).toBe(A);
  });

  it('self-assigning the same app twice by the same consultant is idempotent', async () => {
    const { svc, repo } = make();
    seedWorld(repo);
    await svc.selfAssign('app-ca', A);
    await expect(svc.selfAssign('app-ca', A)).resolves.toMatchObject({
      consultant_id: A,
      status: 'active',
    });
  });
});

// ---- SCENARIO 4 & 5: admin assign / reassign / unassign ------------------

describe('Assignment — admin assign/reassign/unassign (SC4, SC5)', () => {
  it('admin assigns an unassigned app (audit CONSULTANT_ASSIGNED, actor admin)', async () => {
    const { svc, repo, auditRepo } = make();
    seedWorld(repo);
    await svc.adminAssign('app-au', B, ADMIN);
    expect((await repo.getActivePrimary('app-au'))!.consultant_id).toBe(B);
    const evt = auditRepo.rows.find(
      (e) => e.event_type === 'CONSULTANT_ASSIGNED',
    );
    expect(evt!.actor_role).toBe('admin');
    expect(evt!.payload).toMatchObject({
      previous_consultant_id: null,
      new_consultant_id: B,
    });
  });

  it('admin assign on an already-active app → 409', async () => {
    const { svc, repo } = make();
    seedWorld(repo);
    await svc.adminAssign('app-au', B, ADMIN);
    await expect(svc.adminAssign('app-au', C, ADMIN)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('admin reassign A→B: A loses, B gains, history kept, audit prev/new', async () => {
    const { svc, repo, auditRepo } = make();
    seedWorld(repo);
    repo.mapCountry(B, 'CA');
    await svc.selfAssign('app-ca', A);
    await svc.adminReassign('app-ca', B, ADMIN);

    expect((await repo.getActivePrimary('app-ca'))!.consultant_id).toBe(B);
    // A no longer sees it
    expect(
      (await svc.getConsultantQueue(A)).mine.find((q) => q.id === 'app-ca'),
    ).toBeUndefined();
    // B sees it
    expect((await svc.getConsultantQueue(B)).mine.map((q) => q.id)).toContain(
      'app-ca',
    );
    // history retained (released A row still present)
    expect(
      repo.assignments.filter((x) => x.application_id === 'app-ca').length,
    ).toBe(2);

    const evt = auditRepo.rows.find(
      (e) => e.event_type === 'CONSULTANT_REASSIGNED',
    );
    expect(evt!.actor_role).toBe('admin');
    expect(evt!.payload).toMatchObject({
      previous_consultant_id: A,
      new_consultant_id: B,
    });
  });

  it('reassign cycling A→B→A reactivates A (no unique collision)', async () => {
    const { svc, repo } = make();
    seedWorld(repo);
    repo.mapCountry(B, 'CA');
    await svc.selfAssign('app-ca', A);
    await svc.adminReassign('app-ca', B, ADMIN);
    await svc.adminReassign('app-ca', A, ADMIN);
    expect((await repo.getActivePrimary('app-ca'))!.consultant_id).toBe(A);
  });

  it('admin unassign → UNASSIGNED, audit CONSULTANT_UNASSIGNED prev/new', async () => {
    const { svc, repo, auditRepo } = make();
    seedWorld(repo);
    await svc.adminAssign('app-au', B, ADMIN);
    await svc.unassign('app-au', ADMIN);
    expect(await repo.getActivePrimary('app-au')).toBeNull();
    const evt = auditRepo.rows.find(
      (e) => e.event_type === 'CONSULTANT_UNASSIGNED',
    );
    expect(evt!.payload).toMatchObject({
      previous_consultant_id: B,
      new_consultant_id: null,
    });
    // app re-enters B's queue
    expect((await svc.getConsultantQueue(B)).queue.map((q) => q.id)).toContain(
      'app-au',
    );
  });
});

// ---- SCENARIO 8: portal consistency (admin + applicant views) ------------

describe('Assignment — portal consistency (SC8)', () => {
  it('admin sees all apps + derived status + assignee + date', async () => {
    const { svc, repo } = make();
    seedWorld(repo);
    await svc.selfAssign('app-ca', A);
    const all = await svc.listAllForAdmin();
    expect(all.length).toBe(4);
    const ca = all.find((a) => a.id === 'app-ca')!;
    expect(ca.assignment_status).toBe('ASSIGNED');
    expect(ca.assigned_consultant).toMatchObject({ id: A, email: 'a@x.com' });
    expect(ca.assigned_consultant!.assigned_at).toBeTruthy();
    const au = all.find((a) => a.id === 'app-au')!;
    expect(au.assignment_status).toBe('UNASSIGNED');
    expect(au.assigned_consultant).toBeNull();
  });

  it('applicant sees own apps + assigned consultant + status', async () => {
    const { svc, repo } = make();
    seedWorld(repo);
    await svc.adminAssign('app-ca', A, ADMIN);
    const mine = await svc.getApplicantView('user-1');
    expect(mine.map((a) => a.id)).toEqual(['app-ca']);
    expect(mine[0].assignment_status).toBe('ASSIGNED');
    expect(mine[0].assigned_consultant).toMatchObject({ id: A });
  });

  it('admin filter by status and country', async () => {
    const { svc, repo } = make();
    seedWorld(repo);
    const ca = await svc.listAllForAdmin({ country: 'CA' });
    expect(ca.map((a) => a.id)).toEqual(['app-ca']);
  });
});

// ---- Deleted consultant (SC: cascade) ------------------------------------

describe('Assignment — deleted consultant reverts to UNASSIGNED', () => {
  it('removing the active assignment row makes the app unassigned again', async () => {
    const { svc, repo } = make();
    seedWorld(repo);
    await svc.selfAssign('app-ca', A);
    // simulate FK on delete cascade removing the assignment
    repo.assignments = repo.assignments.filter((x) => x.consultant_id !== A);
    expect(await repo.getActivePrimary('app-ca')).toBeNull();
    const all = await svc.listAllForAdmin();
    expect(all.find((a) => a.id === 'app-ca')!.assignment_status).toBe(
      'UNASSIGNED',
    );
  });
});

// ---- Real-time bus emission (SSE source) ---------------------------------

describe('Assignment — emits real-time bus events on every mutation', () => {
  it('self-assign emits APPLICATION_SELF_ASSIGNED with country + new consultant', async () => {
    const { svc, repo, busEvents } = make();
    seedWorld(repo);
    await svc.selfAssign('app-ca', A);
    expect(busEvents).toEqual([
      {
        type: 'APPLICATION_SELF_ASSIGNED',
        application_id: 'app-ca',
        destination_country: 'CA',
        previous_consultant_id: null,
        new_consultant_id: A,
        timestamp: expect.any(String),
      },
    ]);
  });

  it('admin assign / reassign / unassign each emit the matching event', async () => {
    const { svc, repo, busEvents } = make();
    seedWorld(repo);
    repo.mapCountry(B, 'CA');

    await svc.adminAssign('app-ca', A, ADMIN);
    await svc.adminReassign('app-ca', B, ADMIN);
    await svc.unassign('app-ca', ADMIN);

    expect(busEvents.map((e) => e.type)).toEqual([
      'APPLICATION_ASSIGNED',
      'APPLICATION_REASSIGNED',
      'APPLICATION_UNASSIGNED',
    ]);
    expect(busEvents[1]).toMatchObject({
      previous_consultant_id: A,
      new_consultant_id: B,
    });
    expect(busEvents[2]).toMatchObject({
      previous_consultant_id: B,
      new_consultant_id: null,
    });
    // every event carries the destination country for the SSE country filter
    expect(busEvents.every((e) => e.destination_country === 'CA')).toBe(true);
  });
});

// ---- Schengen bloc visibility (R1: SQL RLS ↔ service-layer parity) -------

describe('Assignment — SCHENGEN bloc expansion (mirrors consultant_covers_country)', () => {
  const SCHEN = 'consSchengen';

  function seedSchengen(repo: FakeAssignmentRepository) {
    // A consultant whose coverage is the area-wide bloc.
    repo.mapCountry(SCHEN, 'SCHENGEN');
    repo.emails.set(SCHEN, 'schengen@x.com');
    repo.addApp({ id: 'app-de', user_id: 'u-de', destination_country: 'DE' });
    repo.addApp({ id: 'app-fr', user_id: 'u-fr', destination_country: 'FR' });
    repo.addApp({
      id: 'app-legacy-schengen',
      user_id: 'u-leg',
      destination_country: 'SCHENGEN',
    });
    repo.addApp({ id: 'app-ca2', user_id: 'u-ca', destination_country: 'CA' });
  }

  it('SCHENGEN consultant sees member-coded (DE/FR) AND legacy SCHENGEN apps in the queue', async () => {
    const { svc, repo } = make();
    seedSchengen(repo);
    const r = await svc.getConsultantQueue(SCHEN);
    const ids = r.queue.map((q) => q.id).sort();
    expect(ids).toEqual(['app-de', 'app-fr', 'app-legacy-schengen'].sort());
    // A non-Schengen app (CA) is NOT in a SCHENGEN consultant's queue.
    expect(r.queue.find((q) => q.id === 'app-ca2')).toBeUndefined();
  });

  it('SCHENGEN consultant can self-assign a member-coded (DE) app', async () => {
    const { svc, repo } = make();
    seedSchengen(repo);
    const asg = await svc.selfAssign('app-de', SCHEN);
    expect(asg).toMatchObject({
      application_id: 'app-de',
      consultant_id: SCHEN,
      status: 'active',
    });
  });

  it('SCHENGEN consultant cannot self-assign a non-member (CA) app (403)', async () => {
    const { svc, repo } = make();
    seedSchengen(repo);
    await expect(svc.selfAssign('app-ca2', SCHEN)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('a DE-only consultant covers DE but not the legacy SCHENGEN bloc app', async () => {
    const { svc, repo } = make();
    repo.mapCountry('consDE', 'DE');
    repo.addApp({ id: 'app-de2', user_id: 'u1', destination_country: 'DE' });
    repo.addApp({
      id: 'app-leg',
      user_id: 'u2',
      destination_country: 'SCHENGEN',
    });
    const r = await svc.getConsultantQueue('consDE');
    expect(r.queue.map((q) => q.id)).toEqual(['app-de2']);
  });
});

// ---- pure helper unit tests (the shared bloc rule) -----------------------

describe('consultantCoversCountry / expandCoveredCodes (shared bloc helpers)', () => {
  it('exact match wins regardless of bloc', () => {
    expect(consultantCoversCountry(['CA', 'US'], 'CA')).toBe(true);
    expect(consultantCoversCountry(['CA'], 'US')).toBe(false);
  });

  it('SCHENGEN coverage expands to member states', () => {
    expect(consultantCoversCountry(['SCHENGEN'], 'DE')).toBe(true);
    expect(consultantCoversCountry(['SCHENGEN'], 'FR')).toBe(true);
    expect(consultantCoversCountry(['SCHENGEN'], 'CH')).toBe(true);
  });

  it('SCHENGEN coverage still covers the legacy SCHENGEN code (exact branch)', () => {
    expect(consultantCoversCountry(['SCHENGEN'], 'SCHENGEN')).toBe(true);
  });

  it('SCHENGEN coverage does NOT cover non-member codes', () => {
    expect(consultantCoversCountry(['SCHENGEN'], 'CA')).toBe(false);
    expect(consultantCoversCountry(['SCHENGEN'], 'GB')).toBe(false);
  });

  it('null destination is never covered', () => {
    expect(consultantCoversCountry(['SCHENGEN'], null)).toBe(false);
  });

  it('accepts a ReadonlySet as well as an array', () => {
    expect(consultantCoversCountry(new Set(['SCHENGEN']), 'IT')).toBe(true);
  });

  it('expandCoveredCodes adds the 29 members when SCHENGEN is present', () => {
    const out = expandCoveredCodes(['SCHENGEN', 'CA']);
    expect(out).toContain('CA');
    expect(out).toContain('SCHENGEN');
    expect(out).toContain('DE');
    expect(out).toContain('FR');
    expect(out).toContain('BG'); // full member since 2024/2025
    expect(out).toContain('RO'); // full member since 2024/2025
    expect(out.length).toBe(2 + 29); // CA + SCHENGEN + 29 members
  });

  it('expandCoveredCodes is a no-op without SCHENGEN', () => {
    expect(expandCoveredCodes(['CA', 'US']).sort()).toEqual(['CA', 'US']);
  });
});

// ---- SLA: review deadline + completion + expiry --------------------------

describe('Assignment — review SLA (deadline, completion, expiry)', () => {
  const PAST = '2000-01-01T00:00:00.000Z';

  it('self-assign stamps a future deadline + self-assigned attribution', async () => {
    const { svc, repo } = make();
    seedWorld(repo);
    await svc.selfAssign('app-ca', A);
    const view = (await svc.listAllForAdmin()).find((a) => a.id === 'app-ca');
    expect(view!.assigned_consultant!.assigned_by_role).toBe('consultant');
    expect(Date.parse(view!.assigned_consultant!.due_at!)).toBeGreaterThan(
      Date.now(),
    );
    expect(view!.assigned_consultant!.completed_at).toBeNull();
  });

  it('admin assign attributes assigned_by_role=admin (+ email)', async () => {
    const { svc, repo } = make();
    seedWorld(repo);
    repo.emails.set(ADMIN, 'admin@x.com');
    await svc.adminAssign('app-ca', A, ADMIN);
    const view = (await svc.listAllForAdmin()).find((a) => a.id === 'app-ca');
    expect(view!.assigned_consultant!.assigned_by_role).toBe('admin');
    expect(view!.assigned_consultant!.assigned_by_email).toBe('admin@x.com');
  });

  it('admin setDeadline overrides due_at; rejects out-of-range hours', async () => {
    const { svc, repo, auditRepo } = make();
    seedWorld(repo);
    await svc.selfAssign('app-ca', A);
    const { due_at } = await svc.setDeadline('app-ca', 1, ADMIN);
    expect(Date.parse(due_at)).toBeGreaterThan(Date.now());
    expect(
      auditRepo.rows.some(
        (e) => e.event_type === 'CONSULTANT_DEADLINE_CHANGED',
      ),
    ).toBe(true);
    await expect(svc.setDeadline('app-ca', 0, ADMIN)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('setDeadline on an unassigned app throws (no active consultant)', async () => {
    const { svc, repo } = make();
    seedWorld(repo);
    await expect(svc.setDeadline('app-ca', 24, ADMIN)).rejects.toBeTruthy();
  });

  it('markComplete stops the clock — not swept even when past due', async () => {
    const { svc, repo } = make();
    seedWorld(repo);
    await svc.selfAssign('app-ca', A);
    await svc.markComplete('app-ca', A);
    await repo.setDeadline('app-ca', A, PAST); // force past-due
    const a = await svc.getConsultantQueue(A); // triggers the sweep
    expect(a.mine.map((q) => q.id)).toContain('app-ca'); // still mine
    expect(a.queue.find((q) => q.id === 'app-ca')).toBeUndefined();
  });

  it('non-assignee cannot markComplete (403)', async () => {
    const { svc, repo } = make();
    seedWorld(repo);
    await svc.selfAssign('app-ca', A);
    await expect(svc.markComplete('app-ca', B)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('past-due + not completed → swept back to queue (audit + bus event)', async () => {
    const { svc, repo, auditRepo, busEvents } = make();
    seedWorld(repo);
    await svc.selfAssign('app-ca', A);
    await repo.setDeadline('app-ca', A, PAST); // simulate the window elapsing

    const released = await svc.releaseExpired();
    expect(released).toBe(1);

    // back in the eligible queue, no longer assigned
    const a = await svc.getConsultantQueue(A);
    expect(a.queue.map((q) => q.id)).toContain('app-ca');
    expect(a.mine.find((q) => q.id === 'app-ca')).toBeUndefined();

    // audited as expired + bus emitted APPLICATION_UNASSIGNED
    expect(
      auditRepo.rows.some(
        (e) => e.event_type === 'CONSULTANT_ASSIGNMENT_EXPIRED',
      ),
    ).toBe(true);
    expect(
      busEvents.some(
        (e) =>
          e.type === 'APPLICATION_UNASSIGNED' && e.application_id === 'app-ca',
      ),
    ).toBe(true);
  });

  it('getConsultantQueue sweeps expired before returning (lazy expiry)', async () => {
    const { svc, repo } = make();
    seedWorld(repo);
    await svc.selfAssign('app-ca', A);
    await repo.setDeadline('app-ca', A, PAST);
    // No explicit releaseExpired() — the read path must sweep.
    const a = await svc.getConsultantQueue(A);
    expect(a.queue.map((q) => q.id)).toContain('app-ca');
  });
});
