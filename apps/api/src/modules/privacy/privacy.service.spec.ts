import { PrivacyService } from './privacy.service';
import type { SupabaseService } from '../shared/supabase/supabase.service';

/**
 * The last-admin guard reads the subject before erasing them. These fixtures
 * are about other concerns, so the subject is an ordinary user.
 */
const ordinarySubject = (id = 'user-1') => ({
  getUserById: jest.fn(async () => ({
    data: { user: { id, email: 'a@b.com', app_metadata: { role: 'user' } } },
    error: null,
  })),
  listUsers: jest.fn(async () => ({ data: { users: [] }, error: null })),
});

function makeAdmin(
  deleteUserError: { message: string } | null,
  /**
   * Who is deleting themselves, and how many admins the platform has. Defaults
   * to an ordinary user, so the last-admin guard is a no-op for every test that
   * does not care about it.
   */
  self: {
    appMetadata?: unknown;
    email?: string;
    grants?: string[];
    otherAdmins?: Array<{ id: string; app_metadata?: unknown }>;
  } = {},
) {
  const inserts: unknown[] = [];
  const admin = {
    auth: {
      admin: {
        deleteUser: jest.fn(async () => ({ error: deleteUserError })),
        getUserById: jest.fn(async () => ({
          data: {
            user: {
              id: 'user-1',
              email: self.email ?? 'a@b.com',
              app_metadata: self.appMetadata ?? {},
            },
          },
          error: null,
        })),
        listUsers: jest.fn(async ({ page }: { page: number }) => ({
          data: {
            users:
              page === 1
                ? [
                    {
                      id: 'user-1',
                      email: self.email ?? 'a@b.com',
                      app_metadata: self.appMetadata ?? {},
                    },
                    ...(self.otherAdmins ?? []),
                  ]
                : [],
          },
          error: null,
        })),
      },
    },
    storage: {
      from: () => ({
        list: jest.fn(async () => ({ data: [] })),
        remove: jest.fn(async () => ({ error: null })),
      }),
    },
    from: (table: string) => {
      if (table === 'user_roles') {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          range: () => chain,
          then: (res: (v: unknown) => unknown) =>
            res({
              data: (self.grants ?? []).map((key) => ({
                user_id: 'user-1',
                roles: { key },
              })),
              error: null,
            }),
        };
        return chain;
      }
      if (table === 'users') {
        const chain: Record<string, unknown> = {
          select: () => chain,
          in: () => Promise.resolve({ data: [], error: null }),
        };
        return chain;
      }
      return {
        insert: jest.fn(async (row: unknown) => {
          inserts.push(row);
          return { error: null };
        }),
      };
    },
  };
  return { admin, inserts };
}

describe('PrivacyService.deleteAccount', () => {
  it('deletes the auth identity (DB cascade) and records the erasure', async () => {
    const { admin, inserts } = makeAdmin(null);
    const svc = new PrivacyService({ admin } as unknown as SupabaseService);

    const res = await svc.deleteAccount('user-1', 'a@b.com');

    expect(res.deleted).toBe(true);
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledWith('user-1');
    // a retained deletion record is written
    expect(inserts).toContainEqual(
      expect.objectContaining({
        kind: 'deletion',
        status: 'completed',
        subject_email: 'a@b.com',
      }),
    );
  });

  it('throws and records a failure when the auth deletion fails', async () => {
    const { admin, inserts } = makeAdmin({ message: 'boom' });
    const svc = new PrivacyService({ admin } as unknown as SupabaseService);

    await expect(svc.deleteAccount('user-1', 'a@b.com')).rejects.toThrow(
      /boom/,
    );
    expect(inserts).toContainEqual(
      expect.objectContaining({ kind: 'deletion', status: 'failed' }),
    );
  });
});

/**
 * PRIV-002 regression cover.
 *
 * `deleteAccount` recorded the erasure with `user_id: userId` AFTER deleting
 * that user. `privacy_requests.user_id` is a FK with `ON DELETE SET NULL`,
 * which rewrites rows that already exist — it cannot rescue an INSERT naming a
 * user that is already gone. Every erasure therefore hit a foreign-key
 * violation, and `record()` only warned, so the audit row was silently dropped.
 * Verified live before the fix: after a successful deletion `privacy_requests`
 * held the export and no erasure.
 *
 * The suite did not catch it because the fake `insert` always returned
 * `{ error: null }` and the assertion used `objectContaining` without checking
 * `user_id`. This fake enforces the constraint instead.
 */
function makeAdminWithFk(deletedUserId: string) {
  const inserts: Record<string, unknown>[] = [];
  let userDeleted = false;
  const admin = {
    auth: {
      admin: {
        ...ordinarySubject(deletedUserId),
        deleteUser: jest.fn(async () => {
          userDeleted = true;
          return { error: null };
        }),
      },
    },
    storage: {
      from: () => ({
        list: jest.fn(async () => ({ data: [] })),
        remove: jest.fn(async () => ({ error: null })),
      }),
    },
    from: () => ({
      insert: jest.fn(async (row: Record<string, unknown>) => {
        // The real constraint: a non-null user_id must reference a live user.
        if (userDeleted && row.user_id === deletedUserId) {
          return {
            error: {
              message:
                'insert or update on table "privacy_requests" violates foreign key constraint',
            },
          };
        }
        inserts.push(row);
        return { error: null };
      }),
    }),
  };
  return { admin, inserts };
}

describe('PRIV-002 — the erasure audit record survives the erasure', () => {
  it('records the deletion with a NULL user_id so the FK accepts it', async () => {
    const { admin, inserts } = makeAdminWithFk('user-1');
    const svc = new PrivacyService({ admin } as unknown as SupabaseService);

    await svc.deleteAccount('user-1', 'a@b.com');

    const deletion = inserts.find((r) => r.kind === 'deletion');
    expect(deletion).toBeDefined();
    expect(deletion).toMatchObject({
      kind: 'deletion',
      status: 'completed',
      subject_email: 'a@b.com',
      user_id: null,
    });
  });

  it('still records a FAILED deletion against the live user_id', async () => {
    // The user still exists in this path, so the FK is satisfied and the
    // linkage is worth keeping.
    const { admin, inserts } = makeAdmin({ message: 'boom' });
    const svc = new PrivacyService({ admin } as unknown as SupabaseService);

    await expect(svc.deleteAccount('user-1', 'a@b.com')).rejects.toThrow();

    expect(inserts).toContainEqual(
      expect.objectContaining({
        kind: 'deletion',
        status: 'failed',
        user_id: 'user-1',
      }),
    );
  });
});

describe('SEC-12003 — erasure recurses the full storage tree', () => {
  it('removes deeply-nested message/voice attachments, not just top-level docs', async () => {
    // Emulate the real bucket layout: docs at userId/appId/<file> AND message
    // attachments at userId/appId/messages/<conversationId>/<file>.
    const removed: string[] = [];
    const tree: Record<string, { name: string; metadata: unknown }[]> = {
      'user-1': [{ name: 'app-1', metadata: null }],
      'user-1/app-1': [
        { name: 'passport.png', metadata: { size: 1 } },
        { name: 'messages', metadata: null },
      ],
      'user-1/app-1/messages': [{ name: 'conv-1', metadata: null }],
      'user-1/app-1/messages/conv-1': [
        { name: 'secret-letter.pdf', metadata: { size: 2 } },
        { name: 'voice.webm', metadata: { size: 3 } },
      ],
    };
    const admin = {
      auth: {
        admin: {
          ...ordinarySubject(),
          deleteUser: jest.fn(async () => ({ error: null })),
        },
      },
      storage: {
        from: () => ({
          list: jest.fn(async (prefix: string) => ({
            data: tree[prefix] ?? [],
          })),
          remove: jest.fn(async (paths: string[]) => {
            removed.push(...paths);
            return { error: null };
          }),
        }),
      },
      from: () => ({ insert: jest.fn(async () => ({ error: null })) }),
    };
    const svc = new PrivacyService({ admin } as unknown as SupabaseService);

    const res = await svc.deleteAccount('user-1', 'a@b.com');

    expect(removed).toContain('user-1/app-1/passport.png');
    expect(removed).toContain('user-1/app-1/messages/conv-1/secret-letter.pdf');
    expect(removed).toContain('user-1/app-1/messages/conv-1/voice.webm');
    expect(res.storageRemoved).toBe(3);
  });
});

/**
 * The platform must keep an administrator.
 *
 * `POST /me/privacy/delete` is self-service (JwtGuard only) and HARD-deletes
 * the auth identity, cascading the database. It was the only privilege-removal
 * path with no last-admin check — and the only irreversible one. The sole
 * administrator could erase themselves with nothing left to restore.
 */
describe('PrivacyService.deleteAccount — last-admin protection', () => {
  const svcFor = (admin: unknown) =>
    new PrivacyService({ admin } as unknown as SupabaseService);

  it('refuses when the caller is the only platform admin', async () => {
    const { admin } = makeAdmin(null, { appMetadata: { role: 'admin' } });
    await expect(
      svcFor(admin).deleteAccount('user-1', 'a@b.com'),
    ).rejects.toThrow('last platform administrator');
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it('refuses an admin who holds the role only via an RBAC grant', async () => {
    const { admin } = makeAdmin(null, { grants: ['platform_admin'] });
    await expect(
      svcFor(admin).deleteAccount('user-1', 'a@b.com'),
    ).rejects.toThrow('last platform administrator');
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  /** Erasure is a legal right — it is only the LAST admin who is blocked. */
  it('allows an admin to erase themselves when another admin remains', async () => {
    const { admin } = makeAdmin(null, {
      appMetadata: { role: 'admin' },
      otherAdmins: [{ id: 'admin-2', app_metadata: { role: 'admin' } }],
    });
    await expect(
      svcFor(admin).deleteAccount('user-1', 'a@b.com'),
    ).resolves.toMatchObject({ deleted: true });
    expect(admin.auth.admin.deleteUser).toHaveBeenCalled();
  });

  it('does not stand in the way of an ordinary user', async () => {
    const { admin } = makeAdmin(null, { appMetadata: { role: 'user' } });
    await expect(
      svcFor(admin).deleteAccount('user-1', 'a@b.com'),
    ).resolves.toMatchObject({ deleted: true });
  });

  /** A stored legacy role short-circuits at the gate, so the grant is unreachable. */
  it('treats a grant holder whose metadata says "user" as an ordinary user', async () => {
    const { admin } = makeAdmin(null, {
      appMetadata: { role: 'user' },
      grants: ['platform_admin'],
    });
    await expect(
      svcFor(admin).deleteAccount('user-1', 'a@b.com'),
    ).resolves.toMatchObject({ deleted: true });
  });
});

/**
 * PRIV-004 — a portability export that silently omits a category.
 *
 * `rows()` dropped `error` and returned `[]`, so a failed read of documents,
 * messages or payments was indistinguishable from the subject genuinely having
 * none — and `exportData` then recorded the request `completed`. Under GDPR
 * Art. 15/20 that is an incomplete disclosure AND a false record of compliance.
 */
describe('PrivacyService.exportData — a failed category', () => {
  function db(opts: { failTable?: string }) {
    return {
      from: (table: string) => {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          order: () => chain,
          limit: () => chain,
          then: (res: (v: unknown) => unknown) =>
            res(
              opts.failTable === table
                ? { data: null, error: { message: `${table} unavailable` } }
                : { data: [], error: null },
            ),
        };
        return chain;
      },
    } as never;
  }

  // `users` is read unconditionally; the per-application categories are only
  // reached when the subject actually has applications.
  it('aborts rather than returning a bundle missing a category', async () => {
    const { admin } = makeAdmin(null);
    const svc = new PrivacyService({ admin } as unknown as SupabaseService);

    await expect(
      svc.exportData(db({ failTable: 'users' }), 'u1', 'a@b.com'),
    ).rejects.toThrow('users unavailable');
  });

  it('records the request as FAILED, not completed', async () => {
    const { admin, inserts } = makeAdmin(null);
    const svc = new PrivacyService({ admin } as unknown as SupabaseService);

    await svc
      .exportData(db({ failTable: 'payments' }), 'u1', 'a@b.com')
      .catch(() => undefined);

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ kind: 'export', status: 'failed' });
  });

  it('still records completed when every category reads cleanly', async () => {
    const { admin, inserts } = makeAdmin(null);
    const svc = new PrivacyService({ admin } as unknown as SupabaseService);

    await svc.exportData(db({}), 'u1', 'a@b.com');

    expect(inserts[0]).toMatchObject({ kind: 'export', status: 'completed' });
  });
});
