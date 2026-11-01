import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';
import type { AdminUsersService } from './admin-users.service';

/**
 * ADMIN-003. `POST /admin/users/:id/role` wrote app_metadata.role with no guard,
 * and the admin users table reaches it in two clicks. Demoting the last admin —
 * or yourself — is not recoverable in-product: JwtGuard prefers a valid
 * app_metadata.role over the ADMIN_EMAILS allow-list, so writing 'user' shadows
 * the very fallback that would let the person back in.
 */
function make(opts: {
  target: { email?: string | null; app_metadata?: unknown };
  isAdmin: boolean;
  adminCount: number;
}) {
  return makeWith({ ...opts, isAdmin: () => Promise.resolve(opts.isAdmin) });
}

function makeWith(opts: {
  target: { email?: string | null; app_metadata?: unknown };
  isAdmin: (id: string) => Promise<boolean>;
  adminCount: number;
}) {
  const updateUserById = jest.fn().mockResolvedValue({
    data: { user: { id: 'target', email: opts.target.email ?? 'x@x.com' } },
    error: null,
  });
  const supabase = {
    admin: {
      auth: {
        admin: {
          getUserById: jest
            .fn()
            .mockResolvedValue({ data: { user: opts.target }, error: null }),
          updateUserById,
        },
      },
    },
  } as never;
  const users = {
    isAdminUser: () => false,
    isAdminUserById: (id: string) => opts.isAdmin(id),
    adminCount: () => Promise.resolve(opts.adminCount),
  } as unknown as AdminUsersService;
  return { svc: new AdminService(supabase, users), updateUserById };
}

describe('AdminService.setRole', () => {
  it('refuses to demote the last platform admin', async () => {
    const { svc, updateUserById } = make({
      target: { email: 'boss@x.com', app_metadata: {} },
      isAdmin: true,
      adminCount: 1,
    });
    await expect(svc.setRole('target', 'user', 'actor')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('refuses to demote yourself even when other admins remain', async () => {
    const { svc, updateUserById } = make({
      target: { email: 'boss@x.com', app_metadata: { role: 'admin' } },
      isAdmin: true,
      adminCount: 5,
    });
    await expect(svc.setRole('actor', 'user', 'actor')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('allows demoting an admin while others remain', async () => {
    const { svc, updateUserById } = make({
      target: { email: 'other@x.com', app_metadata: { role: 'admin' } },
      isAdmin: true,
      adminCount: 3,
    });
    await expect(svc.setRole('target', 'user', 'actor')).resolves.toMatchObject(
      {
        appRole: 'user',
      },
    );
    expect(updateUserById).toHaveBeenCalled();
  });

  it('leaves ordinary role changes alone', async () => {
    const { svc, updateUserById } = make({
      target: { email: 'a@x.com', app_metadata: { role: 'user' } },
      isAdmin: false,
      adminCount: 1,
    });
    await expect(
      svc.setRole('target', 'consultant', 'actor'),
    ).resolves.toMatchObject({ appRole: 'consultant' });
    expect(updateUserById).toHaveBeenCalled();
  });

  /** Promotion can never orphan the platform, so it must not pay for a check. */
  it('does not gate promotion to admin', async () => {
    const { svc, updateUserById } = make({
      target: { email: 'a@x.com', app_metadata: {} },
      isAdmin: false,
      adminCount: 0,
    });
    await expect(
      svc.setRole('target', 'admin', 'actor'),
    ).resolves.toMatchObject({
      appRole: 'admin',
    });
    expect(updateUserById).toHaveBeenCalled();
  });

  it('404s on an unknown target instead of writing a role', async () => {
    const supabase = {
      admin: {
        auth: {
          admin: {
            getUserById: jest
              .fn()
              .mockResolvedValue({ data: null, error: { message: 'nope' } }),
            updateUserById: jest.fn(),
          },
        },
      },
    } as never;
    const users = {
      isAdminUser: () => false,
      adminCount: () => Promise.resolve(2),
    } as unknown as AdminUsersService;
    await expect(
      new AdminService(supabase, users).setRole('ghost', 'user', 'actor'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

/**
 * The RBAC half of the same hole. `JwtGuard.resolveAppRole` also authorizes an
 * admin from a `platform_admin` / `super_admin` grant in `user_roles`, and the
 * first version of this guard did not look there — so an admin created through
 * the role tables was demotable even as the last one. It is the worse variant,
 * too: writing the valid legacy role 'user' makes the guard short-circuit on
 * step 1 forever after, so the grant that would have let them back in is never
 * consulted again.
 */
describe('AdminService.setRole — admins granted through the RBAC tables', () => {
  const rbacAdmin = { email: 'rbac@x.com', app_metadata: {} };

  it('refuses to demote the last platform_admin', async () => {
    const { svc, updateUserById } = makeWith({
      target: rbacAdmin,
      isAdmin: () => Promise.resolve(true), // holds platform_admin
      adminCount: 1,
    });
    await expect(svc.setRole('target', 'user', 'actor')).rejects.toThrow(
      'cannot remove the last platform admin',
    );
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('refuses to demote the last super_admin', async () => {
    const { svc, updateUserById } = makeWith({
      target: rbacAdmin,
      isAdmin: () => Promise.resolve(true), // holds super_admin
      adminCount: 1,
    });
    await expect(svc.setRole('target', 'consultant', 'actor')).rejects.toThrow(
      'cannot remove the last platform admin',
    );
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('refuses an RBAC admin demoting themselves', async () => {
    const { svc, updateUserById } = makeWith({
      target: rbacAdmin,
      isAdmin: () => Promise.resolve(true),
      adminCount: 4,
    });
    await expect(svc.setRole('actor', 'user', 'actor')).rejects.toThrow(
      'cannot remove your own admin role',
    );
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('allows demoting an RBAC admin while others remain', async () => {
    const { svc, updateUserById } = makeWith({
      target: rbacAdmin,
      isAdmin: () => Promise.resolve(true),
      adminCount: 2,
    });
    await expect(svc.setRole('target', 'user', 'actor')).resolves.toMatchObject(
      {
        appRole: 'user',
      },
    );
    expect(updateUserById).toHaveBeenCalled();
  });

  /** The lookup must actually happen — a guard that assumes false is the bug. */
  it('asks about the target by id, not just about its metadata', async () => {
    const asked: string[] = [];
    const { svc } = makeWith({
      target: rbacAdmin,
      isAdmin: (id) => {
        asked.push(id);
        return Promise.resolve(true);
      },
      adminCount: 1,
    });
    await expect(svc.setRole('target', 'user', 'actor')).rejects.toThrow();
    expect(asked).toEqual(['target']);
  });

  it('still allows an ordinary user with no grant to be re-roled', async () => {
    const { svc, updateUserById } = makeWith({
      target: { email: 'plain@x.com', app_metadata: {} },
      isAdmin: () => Promise.resolve(false),
      adminCount: 1,
    });
    await expect(
      svc.setRole('target', 'consultant', 'actor'),
    ).resolves.toMatchObject({ appRole: 'consultant' });
    expect(updateUserById).toHaveBeenCalled();
  });
});
