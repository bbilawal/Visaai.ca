import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { ApplicationAccessGuard } from './application-access.guard';

/**
 * Closes a P0: three consultant read routes carried only `@UseGuards(JwtGuard)`
 * and read through the service-role client (which bypasses RLS) keyed on the
 * path parameter alone. Any authenticated user with an application UUID could
 * read a stranger's consultant assignment, reassignment history, and per-field
 * decision rollup.
 *
 * The guard must let in exactly three parties and refuse everyone else.
 */

type Row = Record<string, unknown> | null;

/** Minimal Supabase double: one canned row per table. */
function supabaseStub(rows: {
  applications?: Row;
  consultant_assignments?: Row;
}) {
  const build = (table: keyof typeof rows) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () =>
        Promise.resolve({ data: rows[table] ?? null, error: null }),
    };
    return chain;
  };
  return {
    admin: { from: (table: string) => build(table as keyof typeof rows) },
  } as never;
}

function ctx(
  user: unknown,
  params: Record<string, string> = {},
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user, params, body: {} }) }),
  } as unknown as ExecutionContext;
}

const APP = 'app-1';
const OWNER = { id: 'owner-1', appRole: 'user' };
const CONSULTANT = { id: 'consultant-1', appRole: 'consultant' };
const STRANGER = { id: 'stranger-1', appRole: 'user' };

describe('ApplicationAccessGuard', () => {
  it('lets an admin through without touching the database', async () => {
    const guard = new ApplicationAccessGuard(supabaseStub({}));
    await expect(
      guard.canActivate(
        ctx({ id: 'a', appRole: 'admin' }, { applicationId: APP }),
      ),
    ).resolves.toBe(true);
  });

  it('lets the application OWNER through', async () => {
    const guard = new ApplicationAccessGuard(
      supabaseStub({ applications: { user_id: OWNER.id } }),
    );
    await expect(
      guard.canActivate(ctx(OWNER, { applicationId: APP })),
    ).resolves.toBe(true);
  });

  it('lets an ACTIVE assigned consultant through', async () => {
    const guard = new ApplicationAccessGuard(
      supabaseStub({
        applications: { user_id: OWNER.id },
        consultant_assignments: { id: 'assign-1' },
      }),
    );
    await expect(
      guard.canActivate(ctx(CONSULTANT, { applicationId: APP })),
    ).resolves.toBe(true);
  });

  it('REFUSES a consultant with no active assignment', async () => {
    // A revoked or superseded assignment returns no row, and must mean access
    // ends at that moment rather than persisting.
    const guard = new ApplicationAccessGuard(
      supabaseStub({
        applications: { user_id: OWNER.id },
        consultant_assignments: null,
      }),
    );
    await expect(
      guard.canActivate(ctx(CONSULTANT, { applicationId: APP })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('REFUSES an unrelated authenticated user — the P0 itself', async () => {
    const guard = new ApplicationAccessGuard(
      supabaseStub({
        applications: { user_id: OWNER.id },
        consultant_assignments: null,
      }),
    );
    await expect(
      guard.canActivate(ctx(STRANGER, { applicationId: APP })),
    ).rejects.toThrow(/owner, an assigned consultant, or an admin/i);
  });

  it('fails closed when the application does not exist', async () => {
    const guard = new ApplicationAccessGuard(
      supabaseStub({ applications: null }),
    );
    await expect(
      guard.canActivate(ctx(STRANGER, { applicationId: 'missing' })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses an unauthenticated request', async () => {
    const guard = new ApplicationAccessGuard(supabaseStub({}));
    await expect(
      guard.canActivate(ctx(undefined, { applicationId: APP })),
    ).rejects.toThrow(/not authenticated/i);
  });

  it('refuses when no application id is present', async () => {
    const guard = new ApplicationAccessGuard(supabaseStub({}));
    await expect(guard.canActivate(ctx(OWNER, {}))).rejects.toThrow(
      /Application ID required/i,
    );
  });
});
