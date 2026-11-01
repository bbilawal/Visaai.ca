/**
 * §74 registry visibility.
 *
 * The behaviour worth testing is not the counting — it is what the surface
 * refuses to hide. 125 changes sat in production awaiting a reviewer with no
 * screen to review them on, and every one of those records carried a fabricated
 * description (B-29). A page that shows the counts but launders the
 * "unattributable" flag would recreate the original problem in a nicer font.
 */
import { RegistryOpsService } from './registry-ops.service';
import type { SupabaseService } from '../shared/supabase/supabase.service';

function fake(
  opts: {
    counts?: Record<string, number>;
    changes?: any[];
    run?: any;
    sources?: any[];
    /** Tables whose reads fail, keyed by table name (REGOPS-001). */
    errors?: Record<string, string>;
  } = {},
) {
  const counts = opts.counts ?? {};
  const errors = opts.errors ?? {};
  const from = (table: string) => {
    const chain: any = {};
    chain._head = false;
    // PostgREST silently truncates an unbounded select at PGRST_DB_MAX_ROWS
    // (1000 self-hosted). The fake enforces it so the paging test is real.
    chain._from = 0;
    chain._to = 999;
    chain.select = (_c?: string, o?: { head?: boolean }) => {
      chain._head = Boolean(o?.head);
      return chain;
    };
    for (const m of ['eq', 'neq', 'gte', 'is', 'not', 'or', 'order', 'limit']) {
      chain[m] = () => chain;
    }
    // pageRows uses explicit inclusive ranges rather than an unbounded select.
    chain.range = (f: number, t: number) => {
      chain._from = f;
      chain._to = t;
      return chain;
    };
    const err = table in errors ? { message: errors[table] } : undefined;
    const rows = (all: any[]) => all.slice(chain._from, chain._to + 1);
    // A count query resolves to { count }; a row query to { data }.
    chain.then = (res: (v: any) => unknown) => {
      if (chain._head)
        return Promise.resolve({ count: counts[table] ?? 0, error: err }).then(
          res,
        );
      if (table === 'visa_source_changes') {
        return Promise.resolve({ data: opts.changes ?? [], error: err }).then(
          res,
        );
      }
      if (table === 'visa_sources') {
        return Promise.resolve({
          data: rows(opts.sources ?? []),
          error: err,
        }).then(res);
      }
      return Promise.resolve({ data: [], error: err }).then(res);
    };
    chain.maybeSingle = () =>
      Promise.resolve(
        table === 'visa_sync_runs'
          ? { data: opts.run ?? null, error: err }
          : { data: null, error: err },
      );
    return chain;
  };
  return { admin: { from } } as unknown as SupabaseService;
}

describe('RegistryOpsService', () => {
  it('reports how many changes are waiting for a person', async () => {
    const db = fake({ counts: { visa_source_changes: 125 } });
    const out = await new RegistryOpsService(db).get();
    expect(out.reviews.awaiting).toBe(125);
  });

  it('carries the unattributable flag through instead of smoothing it over', async () => {
    // The B-29 records say "something changed" and cannot say what. A reviewer
    // shown a confident-looking summary with that fact stripped is back where
    // they started.
    const db = fake({
      changes: [
        {
          id: 'c1',
          classification: 'material',
          escalation_reasons: [],
          summary: 'cannot be characterised',
          diff: { unattributable: true, added_total: 0, removed_total: 0 },
          created_at: '2026-08-24T00:00:00Z',
          visa_sources: {
            source_url: 'https://example.gov/x',
            authority: 'Example',
            visa_countries: { name: 'Exampleland' },
          },
        },
        {
          id: 'c2',
          classification: 'material',
          escalation_reasons: ['a fee changed'],
          summary: '3 added, 2 removed',
          diff: { added_total: 3, removed_total: 2 },
          created_at: '2026-08-24T00:00:00Z',
          visa_sources: {
            source_url: 'https://example.gov/y',
            authority: 'Example',
          },
        },
      ],
    });

    const out = await new RegistryOpsService(db).get();
    expect(out.reviews.items[0].unattributable).toBe(true);
    expect(out.reviews.items[1].unattributable).toBe(false);
    expect(out.reviews.unattributable).toBe(1);
    expect(out.reviews.items[0].country).toBe('Exampleland');
    expect(out.reviews.items[1].removedTotal).toBe(2);
  });

  it('counts a source with no successful fetch as stale', async () => {
    // Never fetched is the worst case, not a neutral one. Treating a null
    // last_success_at as "not yet stale" would hide a source that has never
    // worked behind one that merely aged.
    const db = fake({
      sources: [
        { id: 's1', last_success_at: null, freshness_sla: '30 days' },
        {
          id: 's2',
          last_success_at: new Date().toISOString(),
          freshness_sla: '30 days',
        },
      ],
    });
    const out = await new RegistryOpsService(db).get();
    expect(out.sources.staleBeyondSla).toBe(1);
  });

  it('does not call a source stale when it has no SLA to be measured against', async () => {
    const db = fake({
      sources: [{ id: 's1', last_success_at: null, freshness_sla: null }],
    });
    const out = await new RegistryOpsService(db).get();
    expect(out.sources.staleBeyondSla).toBe(0);
  });

  it('separates client-rendered pages from parse errors on the last run', async () => {
    // The whole point of B-28: a page with no text to read is not a parser bug,
    // and merging them makes a permanently-red number nobody reads.
    const db = fake({
      run: {
        started_at: '2026-08-24T18:41:00Z',
        sources_checked: 235,
        ok_count: 45,
        changed_count: 111,
        blocked_count: 74,
        unavailable_count: 4,
        parse_error_count: 0,
        client_rendered_count: 1,
      },
    });
    const out = await new RegistryOpsService(db).get();
    expect(out.lastRun?.parseErrors).toBe(0);
    expect(out.lastRun?.clientRendered).toBe(1);
  });

  it('reports no run rather than inventing an empty one', async () => {
    const out = await new RegistryOpsService(fake()).get();
    expect(out.lastRun).toBeNull();
  });
});

/**
 * REGOPS-001. Every query here discarded its `error`. supabase-js resolves a
 * database error as `{ error }` rather than rejecting, so a failed read did not
 * throw — it produced a spotless page: zero stale sources, zero blocked
 * sources, zero requirements missing provenance, zero changes awaiting review.
 * On a surface whose whole job is to show defects, the outage renders as the
 * all-clear, and the worse it is the healthier the page looks. The consumer
 * already renders "Could not load registry state" from a thrown error.
 */
describe('RegistryOpsService — a failed read is not an all-clear', () => {
  it.each([
    ['visa_sources', 'sources down'],
    ['visa_requirements', 'requirements down'],
    ['visa_source_changes', 'changes down'],
    ['visa_countries', 'countries down'],
  ])('surfaces a failed read of %s', async (table, message) => {
    const db = fake({ errors: { [table]: message } });
    await expect(new RegistryOpsService(db).get()).rejects.toMatchObject({
      message,
    });
  });

  it('does not report zero stale sources when the stale read fails', async () => {
    const db = fake({ errors: { visa_sources: 'boom' } });
    await expect(new RegistryOpsService(db).get()).rejects.toBeDefined();
  });

  /** The row cap: an unbounded select would have stopped at 1000 (DASH-002). */
  it('counts stale sources beyond the PostgREST row cap', async () => {
    const sources = Array.from({ length: 1500 }, (_, i) => ({
      id: `s${i}`,
      last_success_at: null,
      freshness_sla: '30 days',
    }));
    const out = await new RegistryOpsService(fake({ sources })).get();
    expect(out.sources.staleBeyondSla).toBe(1500);
  });
});

/**
 * REGOPS-002. `visa_sources.freshness_sla` is a Postgres `interval`, which
 * PostgREST serializes as '30 days'. The old code did `Number(freshness_sla)`
 * -> NaN -> `!NaN` -> skip, so `staleBeyondSla` was structurally incapable of
 * being anything but 0. These fixtures use the shape the database actually
 * returns; the previous ones used a plain number, which is why the metric
 * looked healthy in CI while never having fired in production.
 */
describe('RegistryOpsService — stale sources, with the real interval shape', () => {
  const daysAgo = (n: number) =>
    new Date(Date.now() - n * 86_400_000).toISOString();

  it('counts a source older than its verbose-interval SLA', async () => {
    const db = fake({
      sources: [
        { id: 's1', last_success_at: daysAgo(45), freshness_sla: '30 days' },
      ],
    });
    const out = await new RegistryOpsService(db).get();
    expect(out.sources.staleBeyondSla).toBe(1);
  });

  it('leaves a source inside its SLA alone', async () => {
    const db = fake({
      sources: [
        { id: 's1', last_success_at: daysAgo(5), freshness_sla: '30 days' },
      ],
    });
    const out = await new RegistryOpsService(db).get();
    expect(out.sources.staleBeyondSla).toBe(0);
  });

  it('handles an hours-scale SLA, not just days', async () => {
    const db = fake({
      sources: [
        {
          id: 's1',
          last_success_at: new Date(Date.now() - 9 * 3_600_000).toISOString(),
          freshness_sla: '6 hours',
        },
      ],
    });
    const out = await new RegistryOpsService(db).get();
    expect(out.sources.staleBeyondSla).toBe(1);
  });

  it('handles the ISO-8601 serialization too', async () => {
    const db = fake({
      sources: [
        { id: 's1', last_success_at: daysAgo(45), freshness_sla: 'P30D' },
      ],
    });
    const out = await new RegistryOpsService(db).get();
    expect(out.sources.staleBeyondSla).toBe(1);
  });

  it('handles a compound interval', async () => {
    const db = fake({
      sources: [
        {
          id: 's1',
          last_success_at: daysAgo(40),
          freshness_sla: '1 mon 2 days',
        },
      ],
    });
    const out = await new RegistryOpsService(db).get();
    expect(out.sources.staleBeyondSla).toBe(1);
  });

  it('still ignores a source with no SLA at all', async () => {
    const db = fake({
      sources: [{ id: 's1', last_success_at: null, freshness_sla: null }],
    });
    const out = await new RegistryOpsService(db).get();
    expect(out.sources.staleBeyondSla).toBe(0);
  });
});
