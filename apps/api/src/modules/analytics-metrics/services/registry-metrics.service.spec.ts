/**
 * Registry health metrics.
 *
 * The alert engine ticked every five minutes in production for weeks with zero
 * rules, because nothing described whether the SOURCE data was sound — the
 * metric registry covered applicant funnels and revenue, not whether the
 * government pages underneath still parsed. These are the numbers a rule can
 * finally watch, so the tests are about the two ways they could quietly lie.
 */
import { RegistryMetricsService } from './registry-metrics.service';
import type { SupabaseService } from '../../shared/supabase/supabase.service';

function fake(opts: { count?: number; runs?: any[] } = {}) {
  const from = (table: string) => {
    const chain: any = {};
    chain.select = () => chain;
    for (const m of ['eq', 'is', 'or', 'gte', 'lte', 'order'])
      chain[m] = () => chain;
    chain.then = (res: (v: any) => unknown) =>
      table === 'visa_sync_runs'
        ? Promise.resolve({ data: opts.runs ?? [] }).then(res)
        : Promise.resolve({ count: opts.count ?? 0 }).then(res);
    return chain;
  };
  return { admin: { from } } as unknown as SupabaseService;
}

const Q = { from: '2026-08-01', to: '2026-08-24', grain: 'day' as const };

describe('RegistryMetricsService', () => {
  it('reports zero requirements without provenance as zero, not as missing', async () => {
    // The number that must be zero. A metric that returned null or omitted the
    // series when healthy would make an alert unable to distinguish "fine" from
    // "not measured" — the exact confusion that let B-30 fire a false recovery.
    const svc = new RegistryMetricsService(fake({ count: 0 }));
    const out = await svc.compute({
      ...Q,
      metric: 'requirements_without_provenance',
    });
    expect(out.total).toBe(0);
    expect(out.series).toEqual([{ bucket: '2026-08-24', value: 0 }]);
    expect(out.unit).toBe('count');
  });

  it('does not spread a current-state gauge across the requested range', async () => {
    // A flat line across three weeks would make a number broken all month look
    // identical to one broken this morning.
    const svc = new RegistryMetricsService(fake({ count: 7 }));
    const out = await svc.compute({ ...Q, metric: 'changes_awaiting_review' });
    expect(out.series).toHaveLength(1);
    expect(out.total).toBe(7);
  });

  it('takes the max parse errors per day, never the sum', async () => {
    // Several runs happen per day and they re-check the same sources. Summing
    // would report six parse errors where one source failed six times, and an
    // alert threshold would fire on the run cadence rather than on the fault.
    const svc = new RegistryMetricsService(
      fake({
        runs: [
          { started_at: '2026-08-23T02:00:00Z', parse_error_count: 1 },
          { started_at: '2026-08-23T08:00:00Z', parse_error_count: 1 },
          { started_at: '2026-08-23T18:00:00Z', parse_error_count: 1 },
        ],
      }),
    );
    const out = await svc.compute({ ...Q, metric: 'parse_errors' });
    expect(out.series).toEqual([{ bucket: '2026-08-23', value: 1 }]);
  });

  it('totals to the latest RUN, not the latest day, so a fixed fault stops firing', async () => {
    // Reality corrected this within minutes of the rules going live: the
    // parse-errors rule breached at 9 while the most recent run had 0. The 9
    // was from a run five hours earlier, before a fix was deployed — a real
    // fault, already fixed, still being reported. A day's maximum answers "did
    // it fail at any point today", and an alert that stays red after you fix
    // the thing is one people learn to ignore.
    const svc = new RegistryMetricsService(
      fake({
        runs: [
          { started_at: '2026-08-23T14:19:00Z', parse_error_count: 9 },
          { started_at: '2026-08-23T17:50:00Z', parse_error_count: 9 },
          { started_at: '2026-08-23T22:03:00Z', parse_error_count: 0 },
        ],
      }),
    );
    const out = await svc.compute({ ...Q, metric: 'parse_errors' });
    expect(out.total).toBe(0);
    // The history is not thrown away: the day still shows its worst point.
    expect(out.series).toEqual([{ bucket: '2026-08-23', value: 9 }]);
  });

  it('totals a run metric to its latest value, not a period sum', async () => {
    // "Is it failing now" is the question an alert asks. A week's sum answers a
    // different one, and would keep firing long after the fault was fixed.
    const svc = new RegistryMetricsService(
      fake({
        runs: [
          { started_at: '2026-08-22T02:00:00Z', parse_error_count: 8 },
          { started_at: '2026-08-23T02:00:00Z', parse_error_count: 0 },
        ],
      }),
    );
    const out = await svc.compute({ ...Q, metric: 'parse_errors' });
    expect(out.total).toBe(0);
    expect(out.series).toHaveLength(2);
  });

  it('keeps client-rendered separate from parse errors', async () => {
    // B-28: a page with no text to read is not a parser bug, and merging them
    // makes a permanently-red number nobody reads.
    const svc = new RegistryMetricsService(
      fake({
        runs: [
          {
            started_at: '2026-08-23T02:00:00Z',
            parse_error_count: 0,
            client_rendered_count: 1,
          },
        ],
      }),
    );
    const out = await svc.compute({ ...Q, metric: 'client_rendered' });
    expect(out.total).toBe(1);
  });

  it('exposes no filters, because these are whole-registry facts', () => {
    expect(new RegistryMetricsService(fake()).supportedFilters).toEqual([]);
  });
});
