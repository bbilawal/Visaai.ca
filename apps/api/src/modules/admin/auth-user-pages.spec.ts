import { allAuthUsers } from './auth-user-pages';

/**
 * Prod 2026-10-14: GoTrue answers listUsers with ~50 users per page whatever
 * perPage asks for. Every loop here asked for 200 and stopped as soon as a page
 * came back shorter than that — i.e. after page 1, the 50 NEWEST users. With
 * 80 users the only consultant (the 10th oldest) was never seen: the admin
 * assignment picker said "no consultants" for every application.
 */
function fakeDirectory(total: number, serverPageSize: number) {
  const users = Array.from({ length: total }, (_, i) => ({
    id: `u${i}`,
    email: `u${i}@x.test`,
    app_metadata: { role: i === 9 ? 'consultant' : 'user' },
  })).reverse(); // GoTrue lists newest first
  const listUsers = jest.fn(
    async ({ page }: { page: number; perPage: number }) => ({
      data: {
        users: users.slice((page - 1) * serverPageSize, page * serverPageSize),
      },
      error: null,
    }),
  );
  return { db: { auth: { admin: { listUsers } } }, listUsers };
}

describe('allAuthUsers', () => {
  it('reads past a short page when the server caps the page size', async () => {
    const { db } = fakeDirectory(80, 50);
    const users = await allAuthUsers(db as never);
    expect(users).toHaveLength(80);
    expect(
      users.some(
        (u) => (u.app_metadata as { role?: string }).role === 'consultant',
      ),
    ).toBe(true);
  });

  it('stops at the first empty page', async () => {
    const { db, listUsers } = fakeDirectory(80, 50);
    await allAuthUsers(db as never);
    expect(listUsers).toHaveBeenCalledTimes(3); // 50, 30, 0
  });

  it('surfaces a listUsers error', async () => {
    const db = {
      auth: {
        admin: {
          listUsers: async () => ({ data: null, error: { message: 'boom' } }),
        },
      },
    };
    await expect(allAuthUsers(db as never)).rejects.toThrow('boom');
  });
});
