import { Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseService } from '../shared/supabase/supabase.service';
import { FeedbackService, type SubmitFeedbackInput } from './feedback.service';

/**
 * The rejection from a call that MUST throw.
 *
 * `svc.x(...).catch(e => e)` types the result as a union of the resolved value
 * and the error, so `.getResponse()` does not typecheck. This also asserts the
 * call actually rejected, rather than letting a silently-resolving call fall
 * through to a vacuous assertion.
 */
async function rejection(
  p: Promise<unknown>,
): Promise<{ getResponse: () => unknown }> {
  let caught: unknown;
  let resolved = false;
  try {
    await p;
    resolved = true;
  } catch (e) {
    caught = e;
  }
  if (resolved) throw new Error('expected the call to reject, but it resolved');
  return caught as { getResponse: () => unknown };
}

/** Captures the row handed to `.insert()` on the RLS-scoped client. */
function makeUserDb() {
  const inserted: Record<string, unknown>[] = [];
  const db = {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserted.push(row);
        return {
          select: () => ({
            single: async () => ({
              data: {
                id: 'fb-1',
                kind: row.kind,
                status: 'new',
                created_at: 'now',
              },
              error: null,
            }),
          }),
        };
      },
    }),
  } as unknown as SupabaseClient;
  return { db, inserted };
}

function makeAdmin(rows: unknown[] = []) {
  const admin = {
    from: () => {
      const chain = {
        select: () => chain,
        gte: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        update: () => chain,
        single: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: rows, error: null }),
      };
      return chain;
    },
  };
  return { admin } as unknown as SupabaseService;
}

const base: SubmitFeedbackInput = {
  kind: 'bug',
  surface: 'web',
  message: 'it broke',
};

describe('FeedbackService.submit', () => {
  it("files feedback on the caller's RLS-scoped client", async () => {
    const { db, inserted } = makeUserDb();
    const svc = new FeedbackService(makeAdmin());

    const res = await svc.submit(db, 'user-1', base);

    expect(res.id).toBe('fb-1');
    expect(inserted[0]).toMatchObject({
      user_id: 'user-1',
      kind: 'bug',
      surface: 'web',
      message: 'it broke',
      rating: null,
    });
  });

  it('logs a database failure without exposing its detail to the caller', async () => {
    const rawError = {
      message: 'relation beta_feedback is missing for tenant internal-prod',
    };
    const db = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({ data: null, error: rawError }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const svc = new FeedbackService(makeAdmin());

    const thrown = await rejection(svc.submit(db, 'user-1', base));

    expect(thrown.getResponse()).toMatchObject({
      message: 'Feedback submission failed',
    });
    expect(JSON.stringify(thrown.getResponse())).not.toContain(
      rawError.message,
    );
    expect(log).toHaveBeenCalledWith(expect.stringContaining(rawError.message));
  });

  describe('device metadata allowlist', () => {
    it('keeps allowlisted keys and drops everything else', async () => {
      const { db, inserted } = makeUserDb();
      const svc = new FeedbackService(makeAdmin());

      await svc.submit(db, 'user-1', {
        ...base,
        device: {
          platform: 'ios',
          os_version: '18.2',
          screen_width: 390,
          is_emulator: false,
          // None of these may ever reach the column.
          email: 'applicant@example.com',
          passport_number: 'X1234567',
          advertising_id: 'abc-123',
          push_token: 'tok',
          ip: '1.2.3.4',
        },
      });

      expect(inserted[0].device).toEqual({
        platform: 'ios',
        os_version: '18.2',
        screen_width: 390,
        is_emulator: false,
      });
    });

    it('drops nested objects and arrays', async () => {
      // Nested structures are where unreviewed data hides; nothing in the
      // allowlist needs one.
      const { db, inserted } = makeUserDb();
      const svc = new FeedbackService(makeAdmin());

      await svc.submit(db, 'user-1', {
        ...base,
        device: {
          platform: { name: 'ios' },
          os_version: ['18.2'],
          locale: 'en-CA',
        },
      });

      expect(inserted[0].device).toEqual({ locale: 'en-CA' });
    });

    it('truncates long string values', async () => {
      const { db, inserted } = makeUserDb();
      const svc = new FeedbackService(makeAdmin());

      await svc.submit(db, 'user-1', {
        ...base,
        device: { device_model: 'x'.repeat(500) },
      });

      expect(
        (inserted[0].device as Record<string, string>).device_model,
      ).toHaveLength(120);
    });
  });

  it('keeps only server-built context keys', async () => {
    const { db, inserted } = makeUserDb();
    const svc = new FeedbackService(makeAdmin());

    await svc.submit(db, 'user-1', base, {
      route: '/applications/new',
      user_agent: 'jest',
      // @ts-expect-error — proving an unknown key cannot slip through the picker
      session_token: 'secret',
    });

    expect(inserted[0].context).toEqual({
      route: '/applications/new',
      user_agent: 'jest',
    });
  });

  it('truncates an over-long message rather than failing the insert', async () => {
    const { db, inserted } = makeUserDb();
    const svc = new FeedbackService(makeAdmin());

    await svc.submit(db, 'user-1', { ...base, message: 'y'.repeat(5000) });

    expect(inserted[0].message as string).toHaveLength(2000);
  });

  describe('rating / kind pairing', () => {
    it('requires a rating for a score-bearing kind', async () => {
      const { db } = makeUserDb();
      const svc = new FeedbackService(makeAdmin());
      await expect(
        svc.submit(db, 'user-1', { kind: 'satisfaction', surface: 'web' }),
      ).rejects.toThrow(/requires a rating/);
    });

    it('rejects a rating outside 1–5', async () => {
      const { db } = makeUserDb();
      const svc = new FeedbackService(makeAdmin());
      await expect(
        svc.submit(db, 'user-1', {
          kind: 'ai_response',
          surface: 'web',
          rating: 9,
        }),
      ).rejects.toThrow(/1–5/);
    });

    it('nulls a rating supplied on a text-only kind', async () => {
      // The column has a CHECK for this; stripping it here means a well-meaning
      // client does not get an opaque constraint violation.
      const { db, inserted } = makeUserDb();
      const svc = new FeedbackService(makeAdmin());

      await svc.submit(db, 'user-1', { ...base, kind: 'bug', rating: 4 });

      expect(inserted[0].rating).toBeNull();
    });

    it('accepts a valid rating on a score-bearing kind', async () => {
      const { db, inserted } = makeUserDb();
      const svc = new FeedbackService(makeAdmin());

      await svc.submit(db, 'user-1', {
        kind: 'ai_response',
        surface: 'web',
        rating: 4,
      });

      expect(inserted[0].rating).toBe(4);
    });
  });

  describe('screenshot safeguards', () => {
    it('refuses an attachment without diagnostics consent', async () => {
      const { db } = makeUserDb();
      const svc = new FeedbackService(makeAdmin());
      await expect(
        svc.submit(db, 'user-1', { ...base, screenshotPath: 'user-1/a.png' }),
      ).rejects.toThrow(/diagnostics consent/);
    });

    it("refuses a path outside the caller's own storage prefix", async () => {
      // Storage RLS would reject the read anyway; failing here stops a row that
      // points at an object its author cannot access.
      const { db } = makeUserDb();
      const svc = new FeedbackService(makeAdmin());
      await expect(
        svc.submit(db, 'user-1', {
          ...base,
          diagnosticsConsent: true,
          screenshotPath: 'user-2/a.png',
        }),
      ).rejects.toThrow(/own storage prefix/);
    });

    it("accepts a consented attachment under the caller's prefix", async () => {
      const { db, inserted } = makeUserDb();
      const svc = new FeedbackService(makeAdmin());

      await svc.submit(db, 'user-1', {
        ...base,
        diagnosticsConsent: true,
        screenshotPath: 'user-1/fb.png',
      });

      expect(inserted[0]).toMatchObject({
        diagnostics_consent: true,
        screenshot_path: 'user-1/fb.png',
      });
    });

    it('defaults diagnostics consent to false when unspecified', async () => {
      const { db, inserted } = makeUserDb();
      const svc = new FeedbackService(makeAdmin());
      await svc.submit(db, 'user-1', base);
      expect(inserted[0].diagnostics_consent).toBe(false);
    });
  });
});

describe('FeedbackService.summary', () => {
  it('reports null — not zero — when nothing has been rated', async () => {
    // 0 is not a possible rating (the scale is 1–5), so reporting 0 for "no
    // data" would be indistinguishable from catastrophically bad and would
    // flow straight into an exit-criteria check.
    const svc = new FeedbackService(
      makeAdmin([
        { kind: 'bug', surface: 'web', status: 'new', rating: null },
        { kind: 'bug', surface: 'ios', status: 'new', rating: null },
      ]),
    );

    const res = await svc.summary('2026-08-01T00:00:00.000Z');

    expect(res.total).toBe(2);
    expect(res.averageRating).toBeNull();
    expect(res.ratingCount).toBe(0);
    expect(res.byKind).toEqual({ bug: 2 });
    expect(res.bySurface).toEqual({ web: 1, ios: 1 });
  });

  it('averages only the rated rows', async () => {
    const svc = new FeedbackService(
      makeAdmin([
        { kind: 'satisfaction', surface: 'web', status: 'new', rating: 5 },
        { kind: 'satisfaction', surface: 'web', status: 'new', rating: 4 },
        { kind: 'bug', surface: 'web', status: 'new', rating: null },
      ]),
    );

    const res = await svc.summary('2026-08-01T00:00:00.000Z');

    expect(res.averageRating).toBe(4.5);
    expect(res.ratingCount).toBe(2);
    expect(res.total).toBe(3);
  });
});

describe('FeedbackService.triage', () => {
  it('derives resolved_at on resolution rather than trusting the caller', async () => {
    const captured: Record<string, unknown>[] = [];
    const admin = {
      from: () => {
        const chain = {
          update: (patch: Record<string, unknown>) => {
            captured.push(patch);
            return chain;
          },
          eq: () => chain,
          select: () => chain,
          single: async () => ({ data: { id: 'fb-1' }, error: null }),
        };
        return chain;
      },
    };

    const svc = new FeedbackService({ admin } as unknown as SupabaseService);
    await svc.triage('fb-1', { status: 'resolved' });

    expect(captured[0].status).toBe('resolved');
    expect(typeof captured[0].resolved_at).toBe('string');
  });

  it('does not set resolved_at for a non-terminal status', async () => {
    const captured: Record<string, unknown>[] = [];
    const admin = {
      from: () => {
        const chain = {
          update: (patch: Record<string, unknown>) => {
            captured.push(patch);
            return chain;
          },
          eq: () => chain,
          select: () => chain,
          single: async () => ({ data: { id: 'fb-1' }, error: null }),
        };
        return chain;
      },
    };

    const svc = new FeedbackService({ admin } as unknown as SupabaseService);
    await svc.triage('fb-1', { status: 'in_progress' });

    expect(captured[0]).not.toHaveProperty('resolved_at');
  });

  it('rejects an empty patch', async () => {
    const svc = new FeedbackService(makeAdmin());
    await expect(svc.triage('fb-1', {})).rejects.toThrow(/No triage changes/);
  });
});

/**
 * `listMine` is the most exposed instance of this pattern: unlike the triage
 * and summary routes it carries no role or permission gate, so ANY
 * authenticated user reaches it. A raw Supabase error interpolated into a
 * `BadRequestException` passes through `AllExceptionsFilter` verbatim — 4xx
 * messages are forwarded by design, so zod validation text reaches the caller —
 * which handed ordinary users table, column and constraint names.
 */
describe('FeedbackService.listMine — error handling', () => {
  function failingDb(error: { message: string }) {
    const chain: Record<string, unknown> = {
      select: () => chain,
      order: () => chain,
      limit: () => Promise.resolve({ data: null, error }),
    };
    return { from: () => chain } as unknown as SupabaseClient;
  }

  it('keeps the database detail out of the response but puts it in the log', async () => {
    const rawError = {
      message: 'permission denied for relation beta_feedback (role anon)',
    };
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const svc = new FeedbackService(makeAdmin());

    const thrown = await rejection(svc.listMine(failingDb(rawError)));

    expect(JSON.stringify(thrown.getResponse())).not.toContain(
      rawError.message,
    );
    expect(thrown.getResponse()).toMatchObject({
      message: 'Feedback read failed',
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining(rawError.message));
    log.mockRestore();
  });

  it('returns the rows when the read succeeds', async () => {
    const rows = [{ id: 'fb-1', kind: 'bug' }];
    const chain: Record<string, unknown> = {
      select: () => chain,
      order: () => chain,
      limit: () => Promise.resolve({ data: rows, error: null }),
    };
    const svc = new FeedbackService(makeAdmin());

    await expect(
      svc.listMine({ from: () => chain } as unknown as SupabaseClient),
    ).resolves.toEqual(rows);
  });
});
