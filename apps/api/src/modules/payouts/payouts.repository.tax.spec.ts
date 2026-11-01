import { PayoutsRepository } from './payouts.repository.impl';
import type { SupabaseService } from '../shared/supabase/supabase.service';

/**
 * TAX-001 — `sumPaidForYear` produced the number on a consultant's annual tax
 * statement, and no test had ever called it. Every test that touched tax
 * generation mocked it away, so its two defects were invisible:
 *
 *   1. `error` was dropped, so a transient read failure became `rows = []` and
 *      a confidently-generated statement reporting ZERO income for a year the
 *      consultant was paid — then upserted and handed to them as a tax document.
 *   2. the select was unbounded, so a busy consultant's year was silently
 *      truncated at PGRST_DB_MAX_ROWS.
 */
const DB_MAX_ROWS = 1000;

function fakeSupabase(opts: {
  rows?: Array<{ amount_usd: number; currency: string }>;
  error?: string;
}) {
  const from = () => {
    const all = opts.rows ?? [];
    let ranged = false;
    let lo = 0;
    let hi = DB_MAX_ROWS - 1;
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      gte: () => chain,
      lt: () => chain,
      order: () => chain,
      range: (f: number, t: number) => {
        ranged = true;
        lo = f;
        hi = t;
        return chain;
      },
      then: (res: (v: any) => unknown) =>
        Promise.resolve(
          opts.error
            ? { data: null, error: { message: opts.error } }
            : {
                data: ranged
                  ? all.slice(lo, hi + 1)
                  : all.slice(0, DB_MAX_ROWS),
                error: null,
              },
        ).then(res),
    };
    return chain;
  };
  return { admin: { from } } as unknown as SupabaseService;
}

const paid = (n: number) =>
  Array.from({ length: n }, () => ({ amount_usd: 100, currency: 'usd' }));

describe('PayoutsRepository.sumPaidForYear', () => {
  it('sums the year the consultant was actually paid', async () => {
    const out = await new PayoutsRepository(
      fakeSupabase({ rows: paid(3) }),
    ).sumPaidForYear('c1', 2026);

    expect(out).toEqual({
      grossPaidCents: 30000,
      payoutCount: 3,
      currency: 'usd',
    });
  });

  it('throws rather than reporting a $0 year when the read fails', async () => {
    await expect(
      new PayoutsRepository(
        fakeSupabase({ error: 'connection reset' }),
      ).sumPaidForYear('c1', 2026),
    ).rejects.toThrow('connection reset');
  });

  it('counts a full year past the PostgREST row cap', async () => {
    const out = await new PayoutsRepository(
      fakeSupabase({ rows: paid(1500) }),
    ).sumPaidForYear('c1', 2026);

    expect(out.payoutCount).toBe(1500);
    expect(out.grossPaidCents).toBe(1500 * 100 * 100); // 1500 payouts x $100
  });

  it('reports an honest zero for a consultant genuinely paid nothing', async () => {
    const out = await new PayoutsRepository(
      fakeSupabase({ rows: [] }),
    ).sumPaidForYear('c1', 2026);

    expect(out).toEqual({
      grossPaidCents: 0,
      payoutCount: 0,
      currency: 'usd',
    });
  });
});
