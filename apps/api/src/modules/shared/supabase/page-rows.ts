/**
 * Read EVERY row a filtered select matches, a page at a time.
 *
 * PostgREST caps an unbounded select at `PGRST_DB_MAX_ROWS` — 1000 in this
 * platform's self-hosted stack (infra/self-hosted/docker-compose.yml) — and it
 * does so SILENTLY: no error, no truncation flag, just the first 1000 rows.
 * Any caller that then sums or filters those rows in JS reports a number that
 * is correct until the table crosses 1000 and quietly wrong forever after, with
 * the error growing as the platform does. It is the exec-dashboard failure mode
 * from REG-001 again — a figure that is wrong in the direction of "everything
 * is smaller and cheaper than you think", which is the direction nobody
 * questions.
 *
 * `.range()` is explicit, so PostgREST honours it — but only up to the cap.
 * A page larger than `PGRST_DB_MAX_ROWS` is still truncated to it, and the
 * "was this the last page?" check (`rows.length < pageSize`) would then read a
 * capped full page as a short one and stop early, silently dropping the rest.
 * `pageSize` is therefore asserted, not merely defaulted.
 *
 * ORDERING: `.range()` is only stable across requests if the query has a
 * deterministic order. With concurrent inserts or deletes between pages, an
 * unordered scan can skip or repeat rows. Callers paging a table that is
 * written while they read MUST apply an `.order()` on a stable key.
 */
export const PAGE_ROWS_SIZE = 1000;

/**
 * supabase-js resolves a database failure as `{ error }` holding a
 * PostgrestError, which is a plain object rather than an `Error`. Throwing it
 * raw loses the stack and stringifies to `[object Object]` at the boundary, so
 * carry the message across and keep the original as `cause`.
 */
export function toError(e: unknown): Error {
  if (e instanceof Error) return e;
  const message =
    typeof e === 'object' && e !== null && 'message' in e
      ? String(e.message)
      : String(e);
  return Object.assign(new Error(message), { cause: e });
}

export interface RangeQuery<T> extends PromiseLike<{
  data: T[] | null;
  error: unknown;
}> {
  range: (from: number, to: number) => RangeQuery<T>;
}

export async function pageRows<T>(
  build: () => RangeQuery<T>,
  pageSize = PAGE_ROWS_SIZE,
): Promise<T[]> {
  // A larger page cannot work: the server caps the response at PAGE_ROWS_SIZE
  // without saying so, and this loop would read that cap as the end of the
  // table. Fail loudly at the call rather than return a silent prefix — the
  // exact failure mode this helper exists to prevent.
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > PAGE_ROWS_SIZE)
    throw new RangeError(
      `pageRows: pageSize must be 1..${PAGE_ROWS_SIZE} (got ${pageSize}); ` +
        'PostgREST silently truncates a larger page to PGRST_DB_MAX_ROWS.',
    );
  const out: T[] = [];
  for (let page = 0; ; page++) {
    const from = page * pageSize;
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw toError(error);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
}
