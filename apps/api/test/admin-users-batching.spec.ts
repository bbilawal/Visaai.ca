import { ConfigService } from '@nestjs/config';
import type { Env } from '../src/config/configuration';
import { AdminUsersService } from '../src/modules/admin/admin-users.service';

/**
 * PERF-002 regression cover.
 *
 * `listUsers` used to await `auth.admin.getUserById(r.id)` once per row, in
 * sequence, for a page of up to 100 users — 100 serial round-trips to GoTrue to
 * render one admin table. The fix batches them with Promise.all, bounded by the
 * page size the DTO already clamps to 100.
 *
 * A sequential loop and a batched one return identical data, so nothing about
 * the RESULT distinguishes them. The only observable difference is CONCURRENCY.
 *
 * This measures concurrency directly, by counting how many calls are in flight
 * at once: a fan-out peaks at ROWS, a serial loop never exceeds 1. Anyone who
 * "simplifies" the Promise.all back into a for-await loop fails here.
 *
 * It used to assert on WALL-CLOCK time instead — "sequential would take >=
 * 200ms, batched ~20ms" — with a comment claiming the margin would not flake on
 * a loaded box. It flaked on a loaded box, inside the full suite, while passing
 * alone. A timing assertion measures the machine as much as the code; peak
 * in-flight is a property of the implementation and cannot flake.
 */
type MinimalDb = {
  auth: { admin: { getUserById: jest.Mock; listUsers?: jest.Mock } };
  from: jest.Mock;
};

const DELAY_MS = 20;
const ROWS = 10;

function makeDb(): {
  db: MinimalDb;
  calls: () => number;
  peakInFlight: () => number;
} {
  let calls = 0;
  let inFlight = 0;
  let peakInFlight = 0;
  const getUserById = jest.fn(async (id: string) => {
    calls += 1;
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    await new Promise((r) => setTimeout(r, DELAY_MS));
    inFlight -= 1;
    return {
      data: { user: { id, email: `${id}@t.test`, app_metadata: {} } },
      error: null,
    };
  });

  const rows = Array.from({ length: ROWS }, (_, i) => ({
    id: `u${i}`,
    email: `u${i}@t.test`,
    status: 'active',
    created_at: new Date().toISOString(),
  }));

  // Chainable stub covering whatever shape the service asks for.
  const builder: Record<string, unknown> = {};
  for (const m of [
    'select',
    'eq',
    'neq',
    'in',
    'or',
    'not',
    'ilike',
    'order',
    'range',
    'limit',
  ]) {
    builder[m] = () => builder;
  }
  Object.assign(builder, {
    then: (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null, count: rows.length }).then(
        res,
      ),
  });

  const rolesBuilder: Record<string, unknown> = {};
  for (const m of ['select', 'in', 'eq']) rolesBuilder[m] = () => rolesBuilder;
  Object.assign(rolesBuilder, {
    then: (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(res),
  });

  return {
    db: {
      auth: { admin: { getUserById } },
      // `users` resolves the page; `user_roles` is the already-batched role
      // lookup and is not what this test is about.
      from: jest.fn((t: string) => (t === 'users' ? builder : rolesBuilder)),
    },
    calls: () => calls,
    peakInFlight: () => peakInFlight,
  };
}

describe('PERF-002 — the admin user list fans out instead of looping', () => {
  it('resolves a page in roughly one round-trip, not one per row', async () => {
    const { db, calls, peakInFlight } = makeDb();
    // The service reads its client through `supabase.admin`, not a bare db arg.
    const svc = new AdminUsersService(
      { admin: db } as never,
      { get: () => [] } as unknown as ConfigService<Env>,
    );

    await (
      svc as unknown as { listUsers: (q: unknown) => Promise<unknown> }
    ).listUsers({
      page: 1,
      pageSize: ROWS,
    });

    // Every row still gets looked up — this is not about doing less work.
    expect(calls()).toBe(ROWS);

    // THE assertion. A for-await loop pins this at exactly 1, whatever the
    // machine is doing; Promise.all over the page reaches ROWS.
    expect(peakInFlight()).toBe(ROWS);
  });
});
