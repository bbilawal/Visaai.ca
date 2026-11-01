import { ConfigService } from '@nestjs/config';
import { AdminUsersService } from './admin-users.service';
import type { Env } from '../../config/configuration';

/**
 * Two findings from the production dry run on 2026-09-06.
 *
 * REG-001 — the app issues Supabase ANONYMOUS identities so an applicant can
 * start the funnel before signing up, and each gets a `users` row. "Users &
 * roles" listed 50 of them when 15 people had actually registered: 35 rows with
 * no email, no name, no role to manage, and a Manage action offering to suspend
 * a session.
 *
 * ADMIN-002 — this service decided "is an admin" from `app_metadata.role`
 * alone, and that key is written for 1 of 50 production users. So nobody read
 * as an admin, and the last-admin guard — which only runs
 * `if (ctx.target.isAdmin)` — could not fire at all. The protection against
 * removing the platform's final administrator was dead code in production.
 * JwtGuard has always honoured ADMIN_EMAILS; the two now agree.
 */

function config(adminEmails: string[]) {
  return {
    get: () => adminEmails,
  } as unknown as ConfigService<Env>;
}

/** Records the filters applied to the `users` query. */
function makeDb(
  authUsers: Array<{ id: string; email: string | null; role?: string }>,
  /** RBAC grants keyed by user id — the third source JwtGuard resolves from. */
  grants: Record<string, string[]> = {},
) {
  const filters: Array<{ method: string; args: unknown[] }> = [];
  const builder: Record<string, unknown> = {};
  for (const m of [
    'select',
    'update',
    'insert',
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
    builder[m] = (...args: unknown[]) => {
      filters.push({ method: m, args });
      return builder;
    };
  }
  // `adminCount` reads status back from `users` for the ids it resolved, so the
  // stub answers with an active row per auth user.
  const userRows = authUsers.map((u) => ({ id: u.id, status: 'active' }));
  Object.assign(builder, {
    then: (res: (v: unknown) => unknown) =>
      Promise.resolve({
        data: userRows,
        error: null,
        count: userRows.length,
      }).then(res),
    // loadTarget reads one status row.
    single: () =>
      Promise.resolve({
        data: userRows[0] ?? { status: 'active' },
        error: null,
      }),
  });

  const rolesBuilder: Record<string, unknown> = {};
  let grantUserId: string | null = null;
  let grantKeys: string[] | null = null;
  for (const m of ['select', 'range']) rolesBuilder[m] = () => rolesBuilder;
  rolesBuilder.eq = (_c: string, v: string) => {
    grantUserId = v;
    return rolesBuilder;
  };
  rolesBuilder.in = (_c: string, v: string[]) => {
    grantKeys = v;
    return rolesBuilder;
  };
  Object.assign(rolesBuilder, {
    then: (res: (v: unknown) => unknown) => {
      const rows = Object.entries(grants)
        .filter(([id]) => (grantUserId ? id === grantUserId : true))
        .flatMap(([id, keys]) =>
          keys
            .filter((k) => (grantKeys ? grantKeys.includes(k) : true))
            .map((key) => ({ user_id: id, roles: { key } })),
        );
      return Promise.resolve({ data: rows, error: null }).then(res);
    },
  });

  const db = {
    auth: {
      admin: {
        listUsers: jest
          .fn()
          // GoTrue pages: page 1 holds everyone, page 2 is empty.
          .mockImplementation(async ({ page }: { page: number }) =>
            page === 1
              ? {
                  data: {
                    users: authUsers.map((u) => ({
                      id: u.id,
                      email: u.email,
                      app_metadata: u.role ? { role: u.role } : {},
                    })),
                  },
                  error: null,
                }
              : { data: { users: [] }, error: null },
          ),
        getUserById: jest.fn(),
        // The lifecycle path bans/unbans in auth before touching the table.
        updateUserById: jest.fn().mockResolvedValue({ error: null }),
      },
    },
    from: (table: string) => (table === 'user_roles' ? rolesBuilder : builder),
  };
  return { db, filters };
}

function makeService(
  authUsers: Array<{ id: string; email: string | null; role?: string }>,
  adminEmails: string[] = [],
  grants: Record<string, string[]> = {},
) {
  const { db, filters } = makeDb(authUsers, grants);
  const svc = new AdminUsersService(
    { admin: db } as never,
    config(adminEmails),
  );
  return { svc, filters, db };
}

const LIST = {
  page: 1,
  pageSize: 25,
  sort: 'createdAt' as const,
  includeGuests: false,
};

describe('AdminUsersService — guests and admin resolution', () => {
  it('excludes anonymous guests from the list by default', async () => {
    const { svc, filters } = makeService([]);

    await svc.listUsers(LIST);

    // An anonymous identity has no email; a registered one always does.
    expect(
      filters.some(
        (f) =>
          f.method === 'not' &&
          f.args[0] === 'email' &&
          f.args[1] === 'is' &&
          f.args[2] === null,
      ),
    ).toBe(true);
  });

  it('includes them when explicitly asked', async () => {
    const { svc, filters } = makeService([]);

    await svc.listUsers({ ...LIST, includeGuests: true });

    expect(filters.some((f) => f.method === 'not')).toBe(false);
  });

  it('counts an ADMIN_EMAILS admin, not just a seeded app_metadata one', async () => {
    // The production shape: nobody has app_metadata.role, and the live admin
    // gets in through the env fallback. Before this, adminCount was 0.
    const { svc, db } = makeService(
      [{ id: 'u-1', email: 'boss@example.com' }],
      ['boss@example.com'],
    );

    const count = await (
      svc as unknown as { adminCount: () => Promise<number> }
    ).adminCount();

    expect(count).toBe(1);
    expect(db.auth.admin.listUsers).toHaveBeenCalled();
  });

  it('still counts a seeded app_metadata admin with no email fallback', async () => {
    const { svc } = makeService(
      [{ id: 'u-1', email: 'x@y.z', role: 'admin' }],
      [],
    );

    const count = await (
      svc as unknown as { adminCount: () => Promise<number> }
    ).adminCount();

    expect(count).toBe(1);
  });

  it('does not count an ordinary user as an admin', async () => {
    const { svc } = makeService(
      [{ id: 'u-1', email: 'someone@example.com' }],
      ['boss@example.com'],
    );

    const count = await (
      svc as unknown as { adminCount: () => Promise<number> }
    ).adminCount();

    expect(count).toBe(0);
  });

  it('matches the admin email case-insensitively', async () => {
    // Emails arrive from GoTrue in whatever case the user typed; the guard must
    // not hinge on that.
    const { svc } = makeService(
      [{ id: 'u-1', email: 'Boss@Example.com' }],
      ['boss@example.com'],
    );

    const count = await (
      svc as unknown as { adminCount: () => Promise<number> }
    ).adminCount();

    expect(count).toBe(1);
  });
});

/**
 * The third source. `JwtGuard.resolveAppRole` also authorizes an admin from a
 * `platform_admin` / `super_admin` grant in `user_roles`, and this service did
 * not look there — so an admin created through the RBAC tables was missing from
 * `adminCount`, and the last-admin guard would happily let the platform's only
 * administrator be removed while reporting a count of zero.
 */
describe('AdminUsersService — admins granted through the RBAC tables', () => {
  const count = (svc: AdminUsersService) =>
    (svc as unknown as { adminCount: () => Promise<number> }).adminCount();

  it('counts a platform_admin grant with no metadata and no allow-list', async () => {
    const { svc } = makeService(
      [{ id: 'u-1', email: 'rbac@example.com' }],
      [],
      {
        'u-1': ['platform_admin'],
      },
    );
    await expect(count(svc)).resolves.toBe(1);
  });

  it('counts a super_admin grant', async () => {
    const { svc } = makeService(
      [{ id: 'u-1', email: 'rbac@example.com' }],
      [],
      {
        'u-1': ['super_admin'],
      },
    );
    await expect(count(svc)).resolves.toBe(1);
  });

  it('does not count org_admin or support_agent as platform admins', async () => {
    const { svc } = makeService(
      [
        { id: 'u-1', email: 'org@example.com' },
        { id: 'u-2', email: 'support@example.com' },
      ],
      [],
      { 'u-1': ['org_admin'], 'u-2': ['support_agent'] },
    );
    await expect(count(svc)).resolves.toBe(0);
  });

  it('counts each admin once across all three sources', async () => {
    const { svc } = makeService(
      [
        { id: 'u-1', email: 'meta@example.com', role: 'admin' },
        { id: 'u-2', email: 'boss@example.com' },
        { id: 'u-3', email: 'rbac@example.com' },
      ],
      ['boss@example.com'],
      { 'u-3': ['platform_admin'] },
    );
    await expect(count(svc)).resolves.toBe(3);
  });

  /**
   * Signed metadata short-circuits in the guard, so a stored 'user' means the
   * grant is never reached and the person cannot get in. Counting them would
   * inflate the pool and let the real last admin be removed.
   */
  it('does not count an RBAC grant that a stored legacy role overrides', async () => {
    const { svc } = makeService(
      [{ id: 'u-1', email: 'rbac@example.com', role: 'user' }],
      [],
      { 'u-1': ['platform_admin'] },
    );
    await expect(count(svc)).resolves.toBe(0);
  });

  it('marks an RBAC admin as isAdmin for the lifecycle guard', async () => {
    const { svc, db } = makeService(
      [{ id: 'u-1', email: 'rbac@example.com' }],
      [],
      {
        'u-1': ['platform_admin'],
      },
    );
    db.auth.admin.getUserById.mockResolvedValue({
      data: {
        user: { id: 'u-1', email: 'rbac@example.com', app_metadata: {} },
      },
      error: null,
    });
    const target = await (
      svc as unknown as {
        loadTarget: (id: string) => Promise<{ isAdmin: boolean }>;
      }
    ).loadTarget('u-1');
    expect(target.isAdmin).toBe(true);
  });
});

/**
 * `isAdminUserById` short-circuits on a valid stored `app_metadata.role` and
 * only then falls through to ADMIN_EMAILS and the RBAC grant — the order
 * `JwtGuard.resolveAppRole` uses. The short-circuit must not issue the grant
 * query at all: the guard would not have consulted it, so neither may we.
 */
describe('AdminUsersService.isAdminUserById', () => {
  const ask = (
    svc: AdminUsersService,
    id: string,
    email: string,
    meta: unknown,
  ) =>
    (
      svc as unknown as {
        isAdminUserById: (
          id: string,
          email: string,
          meta: unknown,
        ) => Promise<boolean>;
      }
    ).isAdminUserById(id, email, meta);

  it('short-circuits on stored role "admin" without reading grants', async () => {
    const { svc, db } = makeService([], [], { 'u-1': ['platform_admin'] });
    await expect(ask(svc, 'u-1', 'a@x.com', { role: 'admin' })).resolves.toBe(
      true,
    );
    expect(db.auth.admin.listUsers).not.toHaveBeenCalled();
  });

  it('short-circuits on stored role "user" even against a grant', async () => {
    const { svc } = makeService([], [], { 'u-1': ['platform_admin'] });
    await expect(ask(svc, 'u-1', 'a@x.com', { role: 'user' })).resolves.toBe(
      false,
    );
  });

  it('short-circuits on stored role "user" even against the allow-list', async () => {
    const { svc } = makeService([], ['a@x.com']);
    await expect(ask(svc, 'u-1', 'a@x.com', { role: 'user' })).resolves.toBe(
      false,
    );
  });

  it('falls through to the allow-list when metadata is silent', async () => {
    const { svc } = makeService([], ['a@x.com']);
    await expect(ask(svc, 'u-1', 'a@x.com', {})).resolves.toBe(true);
  });

  it('falls through to the RBAC grant last', async () => {
    const { svc } = makeService([], [], { 'u-1': ['super_admin'] });
    await expect(ask(svc, 'u-1', 'a@x.com', {})).resolves.toBe(true);
  });

  it('is false when no source claims them', async () => {
    const { svc } = makeService([], ['other@x.com'], { 'u-1': ['org_admin'] });
    await expect(ask(svc, 'u-1', 'a@x.com', {})).resolves.toBe(false);
  });
});

/**
 * The bulk path plans against a snapshot count with a running counter, so a
 * batch cannot drain the admin pool. It reads `isAdmin` from `loadTarget`,
 * which now sees RBAC admins — before that, an RBAC admin looked like an
 * ordinary user and the batch would have removed them without a murmur.
 */
describe('AdminUsersService.bulk — an RBAC admin in the batch', () => {
  it('skips soft-deleting the last admin, who holds the role via a grant', async () => {
    const { svc, db } = makeService(
      [{ id: 'u-1', email: 'rbac@example.com' }],
      [],
      { 'u-1': ['platform_admin'] },
    );
    db.auth.admin.getUserById.mockResolvedValue({
      data: {
        user: { id: 'u-1', email: 'rbac@example.com', app_metadata: {} },
      },
      error: null,
    });

    const res = await svc.bulk(
      { action: 'soft-delete', ids: ['u-1'], reason: 'cleanup' } as never,
      'actor-1',
    );

    expect(res.succeeded).toEqual([]);
    expect(res.skipped).toEqual([
      {
        id: 'u-1',
        reason: 'cannot remove access from the last platform admin',
      },
    ]);
  });

  it('suspends an ordinary user in the same batch shape', async () => {
    const { svc, db } = makeService(
      [
        { id: 'u-1', email: 'rbac@example.com' },
        { id: 'u-2', email: 'plain@example.com' },
      ],
      [],
      { 'u-1': ['platform_admin'] },
    );
    db.auth.admin.getUserById.mockResolvedValue({
      data: {
        user: { id: 'u-2', email: 'plain@example.com', app_metadata: {} },
      },
      error: null,
    });

    const res = await svc.bulk(
      { action: 'suspend', ids: ['u-2'], reason: 'abuse' } as never,
      'actor-1',
    );

    expect(res.skipped).toEqual([]);
    expect(res.succeeded).toEqual(['u-2']);
  });
});
