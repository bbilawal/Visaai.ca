import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuditEvent, ConsultantAssignment } from '@visaai/types';
import { AuditService } from '../src/modules/audit/audit.service';
import type {
  ChainHead,
  IAuditRepository,
  NewAuditEventRow,
} from '../src/modules/audit/audit.repository';
import { AssignmentTimelineService } from '../src/modules/consultant/assignment-timeline.service';
import type { IAssignmentRepository } from '../src/modules/consultant/assignment.repository';

const APP = 'app-1';
const OWNER = 'owner-1';
const ADMIN = 'admin-1';
const C1 = 'cons-1';
const C2 = 'cons-2';

// minimal AuditEvent factory
let seq = 0;
function ev(
  event_type: string,
  actor_id: string | null,
  actor_role: AuditEvent['actor_role'],
  payload: Record<string, unknown>,
): AuditEvent {
  seq += 1;
  return {
    id: `evt-${seq}`,
    application_id: APP,
    seq,
    event_type: event_type as AuditEvent['event_type'],
    actor_id,
    actor_role,
    document_id: null,
    ocr_run_id: null,
    field_key: null,
    submission_session_id: null,
    from_state: null,
    to_state: null,
    payload,
    value_hash: null,
    payload_hash: 'h',
    prev_hash: 'p',
    row_hash: 'r',
    hash_algo: 'sha256',
    canon_version: 1,
    extension_version: null,
    schema_version: null,
    occurred_at: new Date(1_700_000_000_000 + seq * 1000).toISOString(),
  };
}

function fakeAudit(trail: AuditEvent[]): AuditService {
  const repo: IAuditRepository = {
    async getChainHead(): Promise<ChainHead | null> {
      return null;
    },
    async appendEvent(_r: NewAuditEventRow): Promise<AuditEvent> {
      throw new Error('unused');
    },
    async getTrail(): Promise<AuditEvent[]> {
      // contract: seq-ASC
      return [...trail].sort((a, b) => a.seq - b.seq);
    },
    async findByIdempotencyKey(): Promise<AuditEvent | null> {
      return null;
    },
  };
  return new AuditService(repo);
}

function fakeRepo(opts: {
  exists?: boolean;
  active?: string | null;
  emails?: Record<string, string>;
}): IAssignmentRepository {
  const partial = {
    async getApplicationMeta(id: string) {
      return opts.exists === false
        ? null
        : { id, user_id: OWNER, destination_country: 'CA' };
    },
    async getActiveAssignmentFor(
      _app: string,
      consultantId: string,
    ): Promise<ConsultantAssignment | null> {
      return opts.active && consultantId === opts.active
        ? {
            id: 'asg',
            application_id: APP,
            consultant_id: opts.active,
            role: 'primary',
            status: 'active',
            assigned_at: 'x',
            released_at: null,
            due_at: null,
            completed_at: null,
            assigned_by: opts.active,
            assigned_by_role: 'consultant',
          }
        : null;
    },
    async getUserEmails(ids: string[]) {
      const m = new Map<string, string | null>();
      for (const i of ids) m.set(i, opts.emails?.[i] ?? null);
      return m;
    },
  };
  return partial as unknown as IAssignmentRepository;
}

const fullTrail = () => {
  seq = 0;
  return [
    ev('DOCUMENT_UPLOADED', OWNER, 'applicant', {}), // non-assignment: must be filtered
    ev('CONSULTANT_SELF_ASSIGNED', C1, 'consultant', {
      previous_consultant_id: null,
      new_consultant_id: C1,
    }),
    ev('CONSULTANT_REASSIGNED', ADMIN, 'admin', {
      previous_consultant_id: C1,
      new_consultant_id: C2,
    }),
    ev('CONSULTANT_UNASSIGNED', ADMIN, 'admin', {
      previous_consultant_id: C2,
      new_consultant_id: null,
    }),
  ];
};

const ADMIN_CALLER = { id: ADMIN, appRole: 'admin' as const };

describe('AssignmentTimelineService', () => {
  it('returns only assignment events, chronological, with names + prev/new', async () => {
    const svc = new AssignmentTimelineService(
      fakeRepo({ emails: { [C1]: 'c1@x', [C2]: 'c2@x', [ADMIN]: 'a@x' } }),
      fakeAudit(fullTrail()),
    );
    const tl = await svc.getTimeline(APP, ADMIN_CALLER);

    // DOCUMENT_UPLOADED filtered out → 3 assignment events
    expect(tl.map((e) => e.event_type)).toEqual([
      'CONSULTANT_SELF_ASSIGNED',
      'CONSULTANT_REASSIGNED',
      'CONSULTANT_UNASSIGNED',
    ]);
    // chronological ASC
    expect(tl[0].timestamp < tl[1].timestamp).toBe(true);
    expect(tl[1].timestamp < tl[2].timestamp).toBe(true);
    // actor + name mapping
    expect(tl[0]).toMatchObject({
      actor_id: C1,
      actor_name: 'c1@x',
      actor_role: 'consultant',
    });
    // reassign prev → new with names
    expect(tl[1]).toMatchObject({
      previous_consultant_id: C1,
      previous_consultant_name: 'c1@x',
      new_consultant_id: C2,
      new_consultant_name: 'c2@x',
    });
    // unassign → new is null
    expect(tl[2]).toMatchObject({
      new_consultant_id: null,
      new_consultant_name: null,
    });
    // no sensitive payload leakage
    expect(tl[0].metadata).toBeNull();
  });

  it('empty timeline when no assignment events exist', async () => {
    seq = 0;
    const svc = new AssignmentTimelineService(
      fakeRepo({}),
      fakeAudit([ev('DOCUMENT_UPLOADED', OWNER, 'applicant', {})]),
    );
    expect(await svc.getTimeline(APP, ADMIN_CALLER)).toEqual([]);
  });

  it('404 when the application does not exist', async () => {
    const svc = new AssignmentTimelineService(
      fakeRepo({ exists: false }),
      fakeAudit([]),
    );
    await expect(svc.getTimeline(APP, ADMIN_CALLER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  describe('authorization', () => {
    it('owner may view', async () => {
      const svc = new AssignmentTimelineService(
        fakeRepo({}),
        fakeAudit(fullTrail()),
      );
      await expect(
        svc.getTimeline(APP, { id: OWNER, appRole: 'user' }),
      ).resolves.toHaveLength(3);
    });
    it('active assignee may view', async () => {
      const svc = new AssignmentTimelineService(
        fakeRepo({ active: C2 }),
        fakeAudit(fullTrail()),
      );
      await expect(
        svc.getTimeline(APP, { id: C2, appRole: 'consultant' }),
      ).resolves.toHaveLength(3);
    });
    it('a stranger consultant is forbidden', async () => {
      const svc = new AssignmentTimelineService(
        fakeRepo({ active: C2 }),
        fakeAudit(fullTrail()),
      );
      await expect(
        svc.getTimeline(APP, { id: 'cons-other', appRole: 'consultant' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
