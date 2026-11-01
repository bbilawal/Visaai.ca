/**
 * The executive dashboard's data collection — the half that had no test.
 *
 * `shapeDashboard` (dashboard.spec.ts) covers the arithmetic. Every defect this
 * surface has actually shipped lived in the query layer instead: counting guest
 * sessions as registered users (REG-001), and summing a truncated prefix of an
 * event table as if it were the whole window (DASH-002).
 */
import { AdminDashboardService } from './admin-dashboard.service';
import type { SupabaseService } from '../shared/supabase/supabase.service';

interface Tables {
  /** Rows per table; count queries report the filtered length. */
  [table: string]: any[];
}

/**
 * PostgREST's `PGRST_DB_MAX_ROWS`, which the self-hosted stack sets to 1000.
 * The fake enforces it, because a fake that does not would let the truncation
 * bug pass the very tests written to catch it.
 */
const DB_MAX_ROWS = 1000;

function fake(tables: Tables, spy?: { filters: string[]; ranges: number[][] }) {
  const from = (table: string) => {
    let rows = tables[table] ?? [];
    let head = false;
    let ranged = false;
    const chain: any = {
      select: (_c?: string, o?: { head?: boolean }) => {
        head = Boolean(o?.head);
        return chain;
      },
      eq: (col: string, v: unknown) => {
        spy?.filters.push(`${table}.eq(${col})`);
        rows = rows.filter((r) => r[col] === v);
        return chain;
      },
      gte: (col: string, v: string) => {
        rows = rows.filter((r) => String(r[col]) >= v);
        return chain;
      },
      // `.not(col, 'is', null)` — only the column matters to this fake.
      not: (col: string, ...rest: unknown[]) => {
        void rest;
        spy?.filters.push(`${table}.not(${col})`);
        rows = rows.filter((r) => r[col] !== null && r[col] !== undefined);
        return chain;
      },
      order: () => chain,
      limit: (n: number) => {
        rows = rows.slice(0, n);
        return chain;
      },
      range: (f: number, t: number) => {
        ranged = true;
        spy?.ranges.push([f, t]);
        rows = rows.slice(f, t + 1);
        return chain;
      },
      then: (res: (v: any) => unknown) =>
        Promise.resolve(
          head
            ? { count: rows.length, error: null }
            : // Silently truncated, exactly as PostgREST does it: no error, no
              // flag, just a prefix. Only an explicit range escapes the cap.
              { data: ranged ? rows : rows.slice(0, DB_MAX_ROWS), error: null },
        ).then(res),
    };
    return chain;
  };
  return { admin: { from } } as unknown as SupabaseService;
}

const OLD = '2000-01-01T00:00:00Z';
const NOW = new Date().toISOString();

describe('AdminDashboardService.coerceRange', () => {
  it.each([
    ['7d', '7d'],
    ['90d', '90d'],
    ['30d', '30d'],
    ['nonsense', '30d'],
    [undefined, '30d'],
  ])('coerces %s to %s', (input, expected) => {
    expect(AdminDashboardService.coerceRange(input)).toBe(expected);
  });
});

describe('AdminDashboardService — users are registrations, not sessions', () => {
  /**
   * REG-001. The app issues anonymous Supabase identities so an applicant can
   * start before signing up, and each gets a `users` row. Counting them made
   * the tile read 50 against 15 real registrations.
   */
  it('excludes guest rows, which have no email', async () => {
    const db = fake({
      users: [
        { email: 'a@x.com', created_at: NOW },
        { email: 'b@x.com', created_at: OLD },
        { email: null, created_at: NOW },
        { email: null, created_at: NOW },
      ],
    });
    const out = await new AdminDashboardService(db).getDashboard('30d');
    expect(out.users.total).toBe(2);
  });

  it('applies the same exclusion to new-in-range', async () => {
    const db = fake({
      users: [
        { email: 'a@x.com', created_at: NOW },
        { email: 'b@x.com', created_at: OLD },
        { email: null, created_at: NOW },
      ],
    });
    const out = await new AdminDashboardService(db).getDashboard('30d');
    expect(out.users.newInRange).toBe(1);
  });
});

describe('AdminDashboardService — aggregates are not truncated', () => {
  /**
   * DASH-002. PostgREST caps an unbounded select at PGRST_DB_MAX_ROWS (1000 in
   * the self-hosted stack) with no error. `ai_usage_events` is written once per
   * model call, so it is the first table here to cross that line — and when it
   * did, the AI spend tile would report the cost of the first 1000 calls in the
   * window as the cost of the window.
   */
  it('sums every AI event past the row cap, not the first page', async () => {
    const events = Array.from({ length: 2400 }, () => ({
      created_at: NOW,
      input_tokens: 10,
      output_tokens: 5,
      request_cost_usd: '0.01',
      billable_cost_usd: '0.02',
    }));
    const out = await new AdminDashboardService(
      fake({ ai_usage_events: events }),
    ).getDashboard('30d');
    expect(out.ai.tokens).toBe(2400 * 15);
    expect(out.ai.requestCostUsd).toBeCloseTo(24, 6);
    expect(out.ai.billableCostUsd).toBeCloseTo(48, 6);
  });

  it('tallies every completed payment past the row cap', async () => {
    const payments = Array.from({ length: 1200 }, (_, i) => ({
      created_at: NOW,
      status: 'complete',
      plan_tier: i % 2 ? 'pro' : 'starter',
    }));
    const out = await new AdminDashboardService(
      fake({ payments }),
    ).getDashboard('30d');
    expect(out.revenue.completedByTier).toEqual({ starter: 600, pro: 600 });
  });

  it('walks the paged reads in inclusive 1000-row windows', async () => {
    const spy = { filters: [] as string[], ranges: [] as number[][] };
    const events = Array.from({ length: 1500 }, () => ({
      created_at: NOW,
      input_tokens: 1,
      output_tokens: 1,
      request_cost_usd: 0,
      billable_cost_usd: 0,
    }));
    await new AdminDashboardService(
      fake({ ai_usage_events: events }, spy),
    ).getDashboard('30d');
    expect(spy.ranges).toContainEqual([0, 999]);
    expect(spy.ranges).toContainEqual([1000, 1999]);
  });
});

describe('AdminDashboardService — a failed read is reported, not zeroed', () => {
  /**
   * The shape that actually happens. supabase-js RESOLVES a database error as
   * `{ error }` rather than rejecting, so the `count()` helper's
   * `if (error) throw toError(error)` is the only thing standing between a
   * failed read and a confident all-zeros dashboard under a healthy flag. A
   * test that fails the read by THROWING synchronously never reaches that line.
   */
  it('treats a resolved { error } from a count as a failure, not a zero', async () => {
    // ONLY the `users` count fails. Everything else succeeds, so if the helper
    // swallowed the error the dashboard would render dbReachable=true with a
    // confident users.total of 0 — the exact false all-clear being guarded
    // against. Failing every query instead would pass this test either way.
    const db = {
      admin: {
        from: (table: string) => {
          const chain: any = {
            select: () => chain,
            not: () => chain,
            gte: () => chain,
            eq: () => chain,
            order: () => chain,
            limit: () => chain,
            range: () => chain,
            then: (res: (v: any) => unknown) =>
              Promise.resolve(
                table === 'users'
                  ? {
                      count: null,
                      data: null,
                      error: { message: 'permission denied for table users' },
                    }
                  : { count: 0, data: [], error: null },
              ).then(res),
          };
          return chain;
        },
      },
    } as unknown as SupabaseService;

    const out = await new AdminDashboardService(db).getDashboard('30d');

    expect(out.systemHealth).toMatchObject({
      available: false,
      dbReachable: false,
    });
  });

  it('reports dbReachable=false rather than an all-zero all-clear', async () => {
    const db = {
      admin: {
        from: () => {
          throw new Error('db down');
        },
      },
    } as unknown as SupabaseService;
    const out = await new AdminDashboardService(db).getDashboard('30d');
    expect(out.systemHealth).toMatchObject({
      available: false,
      dbReachable: false,
    });
    expect(out.users.total).toBe(0);
  });
});
