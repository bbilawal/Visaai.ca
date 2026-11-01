import { pageRows, type RangeQuery } from './page-rows';

/**
 * A PostgREST-shaped builder over a fixed row set. `range` is inclusive on both
 * ends, as PostgREST's is.
 */
function fakeQuery<T>(rows: T[], onRange?: (from: number, to: number) => void) {
  const make = (from = 0, to = rows.length - 1): RangeQuery<T> => ({
    range: (f: number, t: number) => {
      onRange?.(f, t);
      return make(f, t);
    },
    then: (resolve: any) =>
      Promise.resolve({ data: rows.slice(from, to + 1), error: null }).then(
        resolve,
      ),
  });
  return make();
}

describe('pageRows', () => {
  it('returns every row when the set is smaller than a page', async () => {
    const rows = [{ n: 1 }, { n: 2 }];
    expect(await pageRows(() => fakeQuery(rows), 10)).toEqual(rows);
  });

  it('stops after one round-trip when the first page is short', async () => {
    const seen: number[][] = [];
    await pageRows(
      () => fakeQuery([{ n: 1 }], (f, t) => seen.push([f, t])),
      10,
    );
    expect(seen).toEqual([[0, 9]]);
  });

  /**
   * The defect this exists for: an unbounded select silently stops at
   * PGRST_DB_MAX_ROWS. A caller summing the result would report the first page
   * as the whole total.
   */
  it('walks past the row cap instead of returning a truncated prefix', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ n: i }));
    const got = await pageRows(() => fakeQuery(rows), 1000);
    expect(got).toHaveLength(2500);
    expect(got[2499]).toEqual({ n: 2499 });
  });

  it('requests exactly the inclusive ranges PostgREST expects', async () => {
    const seen: number[][] = [];
    const rows = Array.from({ length: 2500 }, (_, i) => ({ n: i }));
    await pageRows(() => fakeQuery(rows, (f, t) => seen.push([f, t])), 1000);
    expect(seen).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('throws a returned error rather than reporting a short result', async () => {
    const q: RangeQuery<unknown> = {
      range: () => q,
      then: (resolve: any) =>
        Promise.resolve({ data: null, error: new Error('boom') }).then(resolve),
    } as never;
    await expect(pageRows(() => q, 10)).rejects.toThrow('boom');
  });
});
