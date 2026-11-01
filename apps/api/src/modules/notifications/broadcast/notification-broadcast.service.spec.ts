import { NotificationBroadcastService } from './notification-broadcast.service';
import { BroadcastProcessor } from './broadcast.processor';

function svc(repo: Record<string, jest.Mock>, queueAdd = jest.fn()) {
  const supabase = { admin: {} } as never;
  const queue = { add: queueAdd } as never;
  return new NotificationBroadcastService(supabase, repo as never, queue);
}

describe('NotificationBroadcastService.create', () => {
  it('inserts the broadcast and enqueues a fan-out job', async () => {
    const repo = {
      create: jest.fn().mockResolvedValue({ id: 'b1', status: 'sending' }),
    };
    const add = jest.fn().mockResolvedValue({ id: 'job' });
    const s = svc(repo, add);
    const out = await s.create(
      { title: 'Hi', body: 'B', audience: { kind: 'all' }, category: 'system' },
      'admin-1',
    );
    expect(repo.create).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        title: 'Hi',
        created_by: 'admin-1',
        audience: { kind: 'all' },
      }),
    );
    expect(add).toHaveBeenCalledWith(
      'fanout',
      { broadcastId: 'b1' },
      expect.objectContaining({ attempts: 3 }),
    );
    expect((out as { id: string }).id).toBe('b1');
  });
});

describe('BroadcastProcessor.process', () => {
  function proc(
    repo: Record<string, jest.Mock>,
    emit: jest.Mock,
    directory?: {
      users?: Array<{
        id: string;
        email?: string | null;
        app_metadata?: unknown;
      }>;
      grants?: Record<string, string[]>;
    },
  ) {
    const supabase = {
      admin: directory
        ? {
            auth: {
              admin: {
                listUsers: ({ page }: { page: number }) =>
                  Promise.resolve({
                    data: { users: page === 1 ? (directory.users ?? []) : [] },
                    error: null,
                  }),
              },
            },
            from: () => {
              let keys: string[] | null = null;
              const chain: any = {
                select: () => chain,
                eq: () => chain,
                in: (_c: string, v: string[]) => {
                  keys = v;
                  return chain;
                },
                range: () => chain,
                then: (res: (v: unknown) => unknown) =>
                  Promise.resolve({
                    data: Object.entries(directory.grants ?? {}).flatMap(
                      ([id, ks]) =>
                        ks
                          .filter((k) => (keys ? keys.includes(k) : true))
                          .map((key) => ({ user_id: id, roles: { key } })),
                    ),
                    error: null,
                  }).then(res),
              };
              return chain;
            },
          }
        : {},
    } as never;
    const notifications = { emit } as never;
    return new BroadcastProcessor(supabase, notifications, repo as never);
  }

  /**
   * OPS-001. A broadcast to the `admin` audience matched `app_metadata.role`
   * only, so it reached nobody on production and skipped every admin created
   * through the RBAC tables. The audience now resolves the way the login gate
   * does — for `admin` only; other roles have no allow-list and no grant
   * mapping, so they still match on metadata alone.
   */
  function roleBroadcast(role: string) {
    return {
      id: 'b1',
      status: 'sending',
      title: 'T',
      body: 'B',
      link: '/x',
      category: 'system',
      audience: { kind: 'role', role },
    };
  }

  function roleRepo(broadcast: unknown) {
    return {
      getById: jest.fn().mockResolvedValue(broadcast),
      markSent: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
  }

  it('reaches an admin who exists only as an RBAC platform_admin grant', async () => {
    const repo = roleRepo(roleBroadcast('admin'));
    const emit = jest.fn().mockResolvedValue(undefined);
    await proc(repo, emit, {
      users: [
        { id: 'rbac-1', email: 'rbac@x.com', app_metadata: {} },
        { id: 'plain-1', email: 'plain@x.com', app_metadata: {} },
      ],
      grants: { 'rbac-1': ['platform_admin'] },
    }).process({ data: { broadcastId: 'b1' } } as never);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(repo.markSent).toHaveBeenCalledWith(expect.anything(), 'b1', 1);
  });

  it('reaches a super_admin grant holder', async () => {
    const repo = roleRepo(roleBroadcast('admin'));
    const emit = jest.fn().mockResolvedValue(undefined);
    await proc(repo, emit, {
      users: [{ id: 'su-1', email: 'su@x.com', app_metadata: {} }],
      grants: { 'su-1': ['super_admin'] },
    }).process({ data: { broadcastId: 'b1' } } as never);

    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('still reaches a metadata admin', async () => {
    const repo = roleRepo(roleBroadcast('admin'));
    const emit = jest.fn().mockResolvedValue(undefined);
    await proc(repo, emit, {
      users: [
        { id: 'meta-1', email: 'm@x.com', app_metadata: { role: 'admin' } },
        { id: 'plain-1', email: 'p@x.com', app_metadata: { role: 'user' } },
      ],
    }).process({ data: { broadcastId: 'b1' } } as never);

    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('leaves a non-admin role audience matching on metadata alone', async () => {
    const repo = roleRepo(roleBroadcast('consultant'));
    const emit = jest.fn().mockResolvedValue(undefined);
    await proc(repo, emit, {
      users: [
        { id: 'c-1', email: 'c@x.com', app_metadata: { role: 'consultant' } },
        { id: 'rbac-1', email: 'r@x.com', app_metadata: {} },
      ],
      grants: { 'rbac-1': ['platform_admin'] },
    }).process({ data: { broadcastId: 'b1' } } as never);

    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('emits once per explicit-users recipient and marks sent with the count', async () => {
    const broadcast = {
      id: 'b1',
      status: 'sending',
      title: 'T',
      body: 'B',
      link: '/x',
      category: 'system',
      audience: { kind: 'users', userIds: ['u1', 'u2', 'u3'] },
    };
    const repo = {
      getById: jest.fn().mockResolvedValue(broadcast),
      markSent: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    const emit = jest.fn().mockResolvedValue(undefined);
    await proc(repo, emit).process({ data: { broadcastId: 'b1' } } as never);
    expect(emit).toHaveBeenCalledTimes(3);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'system.broadcast',
        userId: 'u1',
        broadcastId: 'b1',
      }),
    );
    expect(repo.markSent).toHaveBeenCalledWith({}, 'b1', 3);
  });

  it('skips a broadcast that is not in sending status', async () => {
    const repo = {
      getById: jest.fn().mockResolvedValue({ id: 'b1', status: 'sent' }),
      markSent: jest.fn(),
      markFailed: jest.fn(),
    };
    const emit = jest.fn();
    await proc(repo, emit).process({ data: { broadcastId: 'b1' } } as never);
    expect(emit).not.toHaveBeenCalled();
    expect(repo.markSent).not.toHaveBeenCalled();
  });

  const failingBroadcast = {
    id: 'b1',
    status: 'sending',
    title: 'T',
    body: 'B',
    link: '/x',
    category: 'system',
    audience: { kind: 'users', userIds: ['u1'] },
  };

  it('marks failed + rethrows only on the FINAL attempt', async () => {
    const repo = {
      getById: jest.fn().mockResolvedValue(failingBroadcast),
      markSent: jest.fn(),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    const emit = jest.fn().mockRejectedValue(new Error('boom'));
    const job = {
      data: { broadcastId: 'b1' },
      attemptsMade: 3,
      opts: { attempts: 3 },
    };
    await expect(proc(repo, emit).process(job as never)).rejects.toThrow(
      'boom',
    );
    expect(repo.markFailed).toHaveBeenCalledWith({}, 'b1');
  });

  it('does NOT mark failed on a non-final attempt (leaves sending so retry resumes)', async () => {
    const repo = {
      getById: jest.fn().mockResolvedValue(failingBroadcast),
      markSent: jest.fn(),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    const emit = jest.fn().mockRejectedValue(new Error('boom'));
    const job = {
      data: { broadcastId: 'b1' },
      attemptsMade: 1,
      opts: { attempts: 3 },
    };
    await expect(proc(repo, emit).process(job as never)).rejects.toThrow(
      'boom',
    );
    expect(repo.markFailed).not.toHaveBeenCalled();
  });
});
