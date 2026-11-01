import {
  countPlatformAdmins,
  hasRbacAdminGrantFor,
  loadRbacAdminIds,
  platformAdminIds,
  resolveAdminEmails,
  type AdminDirectory,
} from './admin-recipients';
import { hasRbacAdminGrant, isPlatformAdmin } from './user-admin-guards';

type AuthUser = { id: string; email?: string | null; app_metadata?: unknown };

/**
 * A directory with both halves the resolver reads: the GoTrue user list and the
 * `user_roles` grant table. Grants are keyed by user id.
 */
function directory(opts: {
  pages?: AuthUser[][];
  grants?: Record<string, string[]>;
  grantError?: string;
  /** `users.status` per id. Absent means no row, which is not deletion. */
  statuses?: Record<string, string>;
  /**
   * Return the `roles(key)` embed as an ARRAY rather than an object. PostgREST
   * does both depending on the relationship it infers, which is why `keysOf`
   * branches on `Array.isArray` — a branch nothing exercised until now.
   */
  arrayEmbed?: boolean;
}): AdminDirectory {
  const grants = opts.grants ?? {};
  return {
    auth: {
      admin: {
        listUsers: ({ page }) =>
          Promise.resolve({
            data: { users: opts.pages?.[page - 1] ?? [] },
            error: null,
          }),
      },
    },
    from: (table: string) => {
      if (table === 'users') {
        const rows = Object.entries(opts.statuses ?? {}).map(
          ([id, status]) => ({
            id,
            status,
          }),
        );
        const usersChain: any = {
          select: () => usersChain,
          in: (_c: string, ids: string[]) =>
            Promise.resolve({
              data: rows.filter((r) => ids.includes(r.id)),
              error: null,
            }),
        };
        return usersChain;
      }
      let userId: string | null = null;
      let keyFilter: string[] | null = null;
      const chain: any = {
        select: () => chain,
        eq: (_col: string, v: string) => {
          userId = v;
          return chain;
        },
        in: (_col: string, v: string[]) => {
          keyFilter = v;
          return chain;
        },
        range: () => chain,
        then: (res: (v: any) => unknown) => {
          if (opts.grantError) {
            return Promise.resolve({
              data: null,
              error: { message: opts.grantError },
            }).then(res);
          }
          const rows = Object.entries(grants)
            .filter(([id]) => (userId ? id === userId : true))
            .flatMap(([id, keys]) =>
              keys
                .filter((k) => (keyFilter ? keyFilter.includes(k) : true))
                .map((key) => ({
                  user_id: id,
                  roles: opts.arrayEmbed ? [{ key }] : { key },
                })),
            );
          return Promise.resolve({ data: rows, error: null }).then(res);
        },
      };
      return chain;
    },
  };
}

async function collect(gen: AsyncGenerator<string>) {
  const out: string[] = [];
  for await (const id of gen) out.push(id);
  return out;
}

describe('isPlatformAdmin — the JWT guard resolution order, ported', () => {
  it('accepts signed app_metadata.role', () => {
    expect(isPlatformAdmin(null, { role: 'admin' }, new Set())).toBe(true);
  });

  /**
   * ADMIN-002: on production the live admin has no app_metadata.role at all —
   * only the allow-list.
   */
  it('accepts the configured admin email when metadata says nothing', () => {
    expect(isPlatformAdmin('boss@x.com', {}, new Set(['boss@x.com']))).toBe(
      true,
    );
  });

  it('matches the allow-list case-insensitively', () => {
    expect(
      isPlatformAdmin('Boss@X.com', undefined, new Set(['boss@x.com'])),
    ).toBe(true);
  });

  /** Source 3: the RBAC grant the first version of this predicate missed. */
  it('accepts an RBAC platform-admin grant with no metadata and no allow-list', () => {
    expect(isPlatformAdmin('rbac@x.com', {}, new Set(), true)).toBe(true);
  });

  /**
   * Signed metadata SHORT-CIRCUITS in the guard, so it must here. Someone on
   * the allow-list whose metadata says 'user' cannot reach /admin; counting
   * them would inflate adminCount and let the real last admin be removed.
   */
  it('lets a stored non-admin role veto the allow-list, as the guard does', () => {
    expect(
      isPlatformAdmin('boss@x.com', { role: 'user' }, new Set(['boss@x.com'])),
    ).toBe(false);
  });

  it('lets a stored non-admin role veto an RBAC grant, as the guard does', () => {
    expect(
      isPlatformAdmin('r@x.com', { role: 'consultant' }, new Set(), true),
    ).toBe(false);
  });

  it('rejects a non-admin role and an unlisted email', () => {
    expect(
      isPlatformAdmin('a@x.com', { role: 'user' }, new Set(['b@x.com'])),
    ).toBe(false);
  });

  it('ignores an unrecognised metadata role and falls through', () => {
    expect(
      isPlatformAdmin('a@x.com', { role: 'wizard' }, new Set(['a@x.com'])),
    ).toBe(true);
  });
});

describe('hasRbacAdminGrant', () => {
  it.each([
    [['platform_admin'], true],
    [['super_admin'], true],
    [['org_admin'], false],
    [['support_agent', 'applicant'], false],
    [['consultant', 'super_admin'], true],
    [[], false],
  ])('%s -> %s', (keys, expected) => {
    expect(hasRbacAdminGrant(keys)).toBe(expected);
  });
});

describe('resolveAdminEmails', () => {
  it('reads the validated config array', () => {
    const cfg = { get: () => ['a@x.com', 'b@x.com'] } as never;
    expect([...resolveAdminEmails(cfg)]).toEqual(['a@x.com', 'b@x.com']);
  });

  it('falls back to the environment rather than to "no admins"', () => {
    const prev = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = ' Boss@X.com , second@x.com ';
    try {
      expect([...resolveAdminEmails()]).toEqual(['boss@x.com', 'second@x.com']);
    } finally {
      if (prev === undefined) delete process.env.ADMIN_EMAILS;
      else process.env.ADMIN_EMAILS = prev;
    }
  });
});

describe('loadRbacAdminIds', () => {
  it('returns only the platform-admin grant holders', async () => {
    const db = directory({
      grants: {
        u1: ['platform_admin'],
        u2: ['super_admin'],
        u3: ['org_admin'],
        u4: ['support_agent'],
      },
    });
    expect([...(await loadRbacAdminIds(db))].sort()).toEqual(['u1', 'u2']);
  });

  it('throws instead of reporting "no admins" when the grant read fails', async () => {
    await expect(
      loadRbacAdminIds(directory({ grantError: 'user_roles down' })),
    ).rejects.toThrow('user_roles down');
  });
});

describe('hasRbacAdminGrantFor', () => {
  it('sees a platform_admin grant', async () => {
    const db = directory({ grants: { u1: ['platform_admin'] } });
    expect(await hasRbacAdminGrantFor(db, 'u1')).toBe(true);
  });

  it('sees a super_admin grant', async () => {
    const db = directory({ grants: { u1: ['super_admin'] } });
    expect(await hasRbacAdminGrantFor(db, 'u1')).toBe(true);
  });

  it('does not treat org_admin as a platform admin', async () => {
    const db = directory({ grants: { u1: ['org_admin'] } });
    expect(await hasRbacAdminGrantFor(db, 'u1')).toBe(false);
  });
});

describe('platformAdminIds', () => {
  /**
   * The production shape that made three watchdogs silent: nobody carries
   * app_metadata.role, so a metadata-only match yields an empty recipient list
   * and the alert is "sent" to no one.
   */
  it('finds the allow-list admin when no user carries admin metadata', async () => {
    const db = directory({
      pages: [
        [
          { id: 'u1', email: 'boss@x.com', app_metadata: {} },
          { id: 'u2', email: 'someone@x.com', app_metadata: { role: 'user' } },
        ],
      ],
    });
    expect(
      await collect(platformAdminIds(db, new Set(['boss@x.com']))),
    ).toEqual(['u1']);
  });

  /** The gap this review caught: RBAC admins were in nobody's recipient list. */
  it('finds an RBAC platform_admin who is on no allow-list', async () => {
    const db = directory({
      pages: [[{ id: 'u9', email: 'rbac@x.com', app_metadata: {} }]],
      grants: { u9: ['platform_admin'] },
    });
    expect(await collect(platformAdminIds(db, new Set()))).toEqual(['u9']);
  });

  it('finds an RBAC super_admin who is on no allow-list', async () => {
    const db = directory({
      pages: [[{ id: 'u9', email: 'rbac@x.com', app_metadata: {} }]],
      grants: { u9: ['super_admin'] },
    });
    expect(await collect(platformAdminIds(db, new Set()))).toEqual(['u9']);
  });

  it('yields nobody when there genuinely is no admin', async () => {
    const db = directory({
      pages: [[{ id: 'u2', email: 'someone@x.com', app_metadata: {} }]],
      grants: { u2: ['applicant'] },
    });
    expect(await collect(platformAdminIds(db, new Set()))).toEqual([]);
  });

  it('pages until a short page — a 201st admin is still notified', async () => {
    const full = Array.from({ length: 200 }, (_, i) => ({
      id: `p1-${i}`,
      email: null,
      app_metadata: { role: 'admin' },
    }));
    const db = directory({
      pages: [
        full,
        [{ id: 'p2-0', email: null, app_metadata: { role: 'admin' } }],
      ],
    });
    const got = await collect(platformAdminIds(db, new Set()));
    expect(got).toHaveLength(201);
    expect(got[200]).toBe('p2-0');
  });

  it('throws rather than reporting an empty recipient list on error', async () => {
    const db: AdminDirectory = {
      ...directory({}),
      auth: {
        admin: {
          listUsers: () =>
            Promise.resolve({ data: null, error: { message: 'gotrue down' } }),
        },
      },
    };
    await expect(collect(platformAdminIds(db, new Set()))).rejects.toThrow(
      'gotrue down',
    );
  });
});

/**
 * `countPlatformAdmins` is the ONE admin count. `IamRepository` had a second
 * one that read `user_roles` rows directly, and the two disagreed in both
 * directions. The dangerous direction is the over-count: the lifecycle path
 * (`AdminUsersService.apply`) bans the auth user and sets `users.status`
 * WITHOUT touching `user_roles`, so a soft-deleted admin's grant row survives.
 * The old revoke guard counted that ghost and would let the last admin who
 * could actually sign in have their role revoked.
 */
describe('countPlatformAdmins', () => {
  it('counts admins across all three sources', async () => {
    const db = directory({
      pages: [
        [
          { id: 'meta', email: 'm@x.com', app_metadata: { role: 'admin' } },
          { id: 'allow', email: 'boss@x.com', app_metadata: {} },
          { id: 'rbac', email: 'r@x.com', app_metadata: {} },
          { id: 'plain', email: 'p@x.com', app_metadata: {} },
        ],
      ],
      grants: { rbac: ['platform_admin'] },
      statuses: {
        meta: 'active',
        allow: 'active',
        rbac: 'active',
        plain: 'active',
      },
    });
    await expect(
      countPlatformAdmins(db, new Set(['boss@x.com'])),
    ).resolves.toBe(3);
  });

  it('does NOT count a soft-deleted admin whose RBAC grant row survives', async () => {
    const db = directory({
      pages: [
        [
          { id: 'ghost', email: 'ghost@x.com', app_metadata: {} },
          { id: 'live', email: 'live@x.com', app_metadata: {} },
        ],
      ],
      grants: { ghost: ['platform_admin'], live: ['platform_admin'] },
      statuses: { ghost: 'deleted', live: 'active' },
    });
    // The old iam count returned 2 here and would have allowed revoking `live`.
    await expect(countPlatformAdmins(db, new Set())).resolves.toBe(1);
  });

  it('counts a suspended admin — a ban is reversible, a delete is not', async () => {
    const db = directory({
      pages: [
        [{ id: 'susp', email: 's@x.com', app_metadata: { role: 'admin' } }],
      ],
      statuses: { susp: 'suspended' },
    });
    await expect(countPlatformAdmins(db, new Set())).resolves.toBe(1);
  });

  it('counts an admin with no users row — absence is not deletion', async () => {
    const db = directory({
      pages: [
        [{ id: 'orphan', email: 'o@x.com', app_metadata: { role: 'admin' } }],
      ],
      statuses: {},
    });
    await expect(countPlatformAdmins(db, new Set())).resolves.toBe(1);
  });

  it('returns 0 without a users query when nobody is an admin', async () => {
    const db = directory({
      pages: [
        [{ id: 'plain', email: 'p@x.com', app_metadata: { role: 'user' } }],
      ],
    });
    await expect(countPlatformAdmins(db, new Set())).resolves.toBe(0);
  });
});

/**
 * PostgREST returns an embedded relation as an object or as an array depending
 * on the relationship it infers. `keysOf` was written to handle both and only
 * the object shape was ever tested, so the array branch could have been deleted
 * without a single failure.
 */
describe('role grants arriving as an array embed', () => {
  it('reads a platform_admin grant from an array-shaped embed', async () => {
    const db = directory({
      grants: { u1: ['platform_admin'] },
      arrayEmbed: true,
    });
    expect([...(await loadRbacAdminIds(db))]).toEqual(['u1']);
  });

  it('reads a single-user grant from an array-shaped embed', async () => {
    const db = directory({ grants: { u1: ['super_admin'] }, arrayEmbed: true });
    expect(await hasRbacAdminGrantFor(db, 'u1')).toBe(true);
  });

  it('still rejects a non-admin key in an array-shaped embed', async () => {
    const db = directory({ grants: { u1: ['org_admin'] }, arrayEmbed: true });
    expect(await hasRbacAdminGrantFor(db, 'u1')).toBe(false);
  });

  it('finds the admin through the full recipient walk', async () => {
    const db = directory({
      pages: [[{ id: 'u1', email: 'r@x.com', app_metadata: {} }]],
      grants: { u1: ['platform_admin'] },
      arrayEmbed: true,
    });
    expect(await collect(platformAdminIds(db, new Set()))).toEqual(['u1']);
  });
});
