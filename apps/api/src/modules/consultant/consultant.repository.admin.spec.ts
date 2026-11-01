import { ConsultantRepository } from './consultant.repository.impl';
import type { ConsultantWriteClient } from './consultant-write-client';

/**
 * PostgREST query-builder fake (jest mock-db style). Each `from(table)` returns
 * a chainable builder whose terminal filters are no-ops for the admin-list path
 * (filtering happens in JS after the awaited fetch). The builder is thenable so
 * `await q` resolves to { data, error }. `update().eq()...` chains are recorded
 * so the setConsultantCountries test can assert the upsert + deactivate calls.
 */
function makeWrites(tables: {
  applications?: Record<string, unknown>[];
  users?: { id: string; email: string | null }[];
}) {
  const calls: Array<{ table: string; op: string; args: unknown[] }> = [];

  function builder(table: string, result: unknown[]) {
    const data = result;
    const chain: Record<string, unknown> = {};
    const passthrough =
      (op: string) =>
      (...args: unknown[]) => {
        calls.push({ table, op, args });
        return chain;
      };
    for (const op of [
      'select',
      'order',
      'eq',
      'ilike',
      'in',
      'is',
      'lt',
      'gt',
      'not',
      'update',
      'upsert',
    ]) {
      chain[op] = passthrough(op);
    }
    // Thenable: awaiting the chain yields the PostgREST { data, error } shape.
    chain.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data, error: null });
    return chain;
  }

  const client = {
    from(table: string) {
      if (table === 'applications') {
        return builder(table, tables.applications ?? []);
      }
      if (table === 'users') {
        return builder(table, tables.users ?? []);
      }
      return builder(table, []);
    },
  };
  return {
    writes: { client } as unknown as ConsultantWriteClient,
    calls,
  };
}

/** Build an applications row with one active primary assignee. */
function appRow(
  id: string,
  opts: {
    consultantId?: string;
    dueAt?: string | null;
    status?: string;
    country?: string;
  } = {},
) {
  const assignments = opts.consultantId
    ? [
        {
          consultant_id: opts.consultantId,
          assigned_at: '2026-01-01T00:00:00.000Z',
          status: 'active',
          role: 'primary',
          assigned_by: null,
          assigned_by_role: 'admin',
          due_at: opts.dueAt ?? null,
          completed_at: null,
        },
      ]
    : [];
  return {
    id,
    user_id: 'owner-1',
    destination_country: opts.country ?? 'CA',
    status: opts.status ?? 'draft',
    created_at: '2026-01-01T00:00:00.000Z',
    consultant_assignments: assignments,
  };
}

describe('ConsultantRepository.listAllApplicationsAdmin — server-side filters', () => {
  const users = [
    { id: 'c-alice', email: 'alice@firm.com' },
    { id: 'c-bob', email: 'bob@other.io' },
  ];

  it('filters by assignmentStatus = UNASSIGNED', async () => {
    const { writes } = makeWrites({
      applications: [
        appRow('app-assigned', { consultantId: 'c-alice' }),
        appRow('app-open'),
      ],
      users,
    });
    const repo = new ConsultantRepository(writes);
    const out = await repo.listAllApplicationsAdmin({
      assignmentStatus: 'UNASSIGNED',
    });
    expect(out.map((r) => r.id)).toEqual(['app-open']);
  });

  it('filters by assignmentStatus = ASSIGNED', async () => {
    const { writes } = makeWrites({
      applications: [
        appRow('app-assigned', { consultantId: 'c-alice' }),
        appRow('app-open'),
      ],
      users,
    });
    const repo = new ConsultantRepository(writes);
    const out = await repo.listAllApplicationsAdmin({
      assignmentStatus: 'ASSIGNED',
    });
    expect(out.map((r) => r.id)).toEqual(['app-assigned']);
  });

  it('filters by assignee email substring (case-insensitive)', async () => {
    const { writes } = makeWrites({
      applications: [
        appRow('app-alice', { consultantId: 'c-alice' }),
        appRow('app-bob', { consultantId: 'c-bob' }),
      ],
      users,
    });
    const repo = new ConsultantRepository(writes);
    const out = await repo.listAllApplicationsAdmin({ assignee: 'FIRM' });
    expect(out.map((r) => r.id)).toEqual(['app-alice']);
  });

  it('filters by due_at within [deadlineFrom, deadlineTo]', async () => {
    const { writes } = makeWrites({
      applications: [
        appRow('app-early', {
          consultantId: 'c-alice',
          dueAt: '2026-06-01T00:00:00.000Z',
        }),
        appRow('app-mid', {
          consultantId: 'c-alice',
          dueAt: '2026-06-15T00:00:00.000Z',
        }),
        appRow('app-late', {
          consultantId: 'c-alice',
          dueAt: '2026-07-01T00:00:00.000Z',
        }),
        appRow('app-none', { consultantId: 'c-alice', dueAt: null }),
      ],
      users,
    });
    const repo = new ConsultantRepository(writes);
    const out = await repo.listAllApplicationsAdmin({
      deadlineFrom: '2026-06-10T00:00:00.000Z',
      deadlineTo: '2026-06-20T00:00:00.000Z',
    });
    expect(out.map((r) => r.id)).toEqual(['app-mid']);
  });

  it('ANDs combined predicates (assignee + assignmentStatus)', async () => {
    const { writes } = makeWrites({
      applications: [
        appRow('app-alice', { consultantId: 'c-alice' }),
        appRow('app-bob', { consultantId: 'c-bob' }),
        appRow('app-open'),
      ],
      users,
    });
    const repo = new ConsultantRepository(writes);
    const out = await repo.listAllApplicationsAdmin({
      assignmentStatus: 'ASSIGNED',
      assignee: 'alice',
    });
    expect(out.map((r) => r.id)).toEqual(['app-alice']);
  });
});

describe('ConsultantRepository.setConsultantCountries — upsert + deactivate', () => {
  it('upserts active=true for codes and deactivates the rest', async () => {
    const { writes, calls } = makeWrites({});
    const repo = new ConsultantRepository(writes);

    await repo.setConsultantCountries('c-1', ['CA', 'DE']);

    const upsert = calls.find((c) => c.op === 'upsert');
    expect(upsert).toBeDefined();
    expect(upsert!.args[0]).toEqual([
      { consultant_id: 'c-1', country_code: 'CA', active: true },
      { consultant_id: 'c-1', country_code: 'DE', active: true },
    ]);

    const update = calls.find((c) => c.op === 'update');
    expect(update!.args[0]).toEqual({ active: false });
    // The deactivate path excludes the kept codes via NOT IN.
    const notCall = calls.find((c) => c.op === 'not');
    expect(notCall!.args).toEqual(['country_code', 'in', '(CA,DE)']);
  });

  it('deactivates everything (no NOT IN) when codes is empty', async () => {
    const { writes, calls } = makeWrites({});
    const repo = new ConsultantRepository(writes);

    await repo.setConsultantCountries('c-1', []);

    expect(calls.find((c) => c.op === 'upsert')).toBeUndefined();
    expect(calls.find((c) => c.op === 'update')!.args[0]).toEqual({
      active: false,
    });
    expect(calls.find((c) => c.op === 'not')).toBeUndefined();
  });
});
