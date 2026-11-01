/**
 * Read every GoTrue auth user.
 *
 * GoTrue's admin listUsers returns about 50 users per page regardless of the
 * `perPage` requested, so "stop when a page is shorter than perPage" stops after
 * the first page — the 50 newest users. That hid the only consultant from the
 * admin assignment picker in prod (80 users, 2026-10-14). Page until an empty
 * page instead; MAX_PAGES bounds a misbehaving server.
 */
export interface AuthUserRow {
  id: string;
  email?: string | null;
  app_metadata?: unknown;
}

export interface AuthUserDirectory {
  auth: {
    admin: {
      listUsers: (params: { page: number; perPage: number }) => Promise<{
        data: { users: AuthUserRow[] } | null;
        error: { message: string } | null;
      }>;
    };
  };
}

const PER_PAGE = 200;
const MAX_PAGES = 1000;

export async function* authUserPages(
  db: AuthUserDirectory,
): AsyncGenerator<AuthUserRow[]> {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await db.auth.admin.listUsers({
      page,
      perPage: PER_PAGE,
    });
    if (error) throw new Error(error.message);
    const users = data?.users ?? [];
    if (users.length === 0) return;
    yield users;
  }
}

export async function allAuthUsers(
  db: AuthUserDirectory,
): Promise<AuthUserRow[]> {
  const out: AuthUserRow[] = [];
  for await (const users of authUserPages(db)) out.push(...users);
  return out;
}
