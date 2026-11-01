/**
 * `.in(column, values)` against PostgREST is a GET with the values in the QUERY
 * STRING, and long lists overflow the request line.
 *
 * THE FAILURE IS SILENT AND EXPENSIVE, which is why this file exists rather
 * than a comment telling people to be careful.
 *
 * A batch of 500 sha256 hashes is ~33 KB of URL. Kong and nginx reject that
 * with `414 URI Too Long`, which supabase-js surfaces as `{ data: null, error }`.
 * Every call site here reads `data ?? []` — the correct defensive shape — so
 * the overflow does not throw. It just returns "nothing found", and each caller
 * draws a wrong conclusion from it:
 *
 *   persistChunks   "no chunk text exists yet" -> reuse reported as zero, so
 *                   the deduplication metric silently reads 0% on exactly the
 *                   large documents where it matters most
 *   embedMissing    "no embedding exists yet" -> re-embeds text that is already
 *                   embedded. The primary key stops the duplicate row; nothing
 *                   stops the bill
 *   coverageReport  "this country has no visa types" -> a coverage gap that is
 *                   not real, filed as a review ticket
 *
 * None of those look like an error anywhere. They look like a corpus with poor
 * deduplication and unexplained embedding costs.
 *
 * So: every `.in()` over a caller-sized list goes through `inBatches`, which
 * sizes batches by BYTES rather than by a count guessed for one column width.
 * A uuid list and a sha256 list have very different safe counts, and hard-coding
 * either is how this comes back.
 */

/**
 * Conservative ceiling for the encoded value list.
 *
 * This was 4096, reasoned from nginx's 8 KB `large_client_header_buffers`
 * default. Both halves of that reasoning were wrong, and the corpus backfill
 * found out on 2026-09-04: three source versions failed every attempt with
 *
 *     embedding lookup failed: An invalid response was received from the
 *     upstream server
 *
 * MEASURED against the production stack, same request shape the ingest issues
 * (`kb_embeddings?select=text_sha256&model=eq...&text_sha256=in.(...)`):
 *
 *     50 hashes   3362 B URI   200
 *     56 hashes   3752 B URI   200
 *     58 hashes   3882 B URI   502   <- not 414
 *     200 hashes 13112 B URI   414
 *
 * Two corrections. The ceiling in front of this stack is ~3.8 KB of TOTAL URI,
 * not 8 KB. And past it Kong answers **502**, not the 414 this file was written
 * to anticipate — so "URI too long" arrives disguised as a flaky upstream, and
 * looks like something to retry rather than something to shrink.
 *
 * The budget also counted the wrong thing: it bounded the VALUE LIST at 4096 B
 * and then let the base URL, `select`, and `model=eq.` filter push the total
 * over. 63 sha256 hashes measured 4096 B of values and 4207 B of URI.
 *
 * 2048 B of values leaves roughly 1.5 KB of headroom for the longest base URL
 * any call site here builds, which is margin rather than a second guess.
 */
const MAX_FILTER_BYTES = 2048;

/** How many values of this shape fit in one request. At least one, always. */
export function batchSizeFor(values: readonly string[]): number {
  if (values.length === 0) return 1;
  // Sample rather than measure every value: the lists here are homogeneous
  // (all uuids, or all hashes), and measuring 20,000 strings to pick a batch
  // size is its own cost.
  const sample = values.slice(0, 20);
  const avg =
    sample.reduce((n, v) => n + encodeURIComponent(v).length + 1, 0) /
    sample.length;
  return Math.max(1, Math.floor(MAX_FILTER_BYTES / Math.max(1, avg)));
}

/** Split into request-sized batches. */
export function batchValues<T extends string>(values: readonly T[]): T[][] {
  const size = batchSizeFor(values);
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size)
    out.push(values.slice(i, i + size));
  return out;
}

/**
 * Run `query` once per batch and concatenate the rows.
 *
 * THROWS on a query error rather than returning partial results. That is the
 * whole point: the bug this module exists to prevent was a query error being
 * read as an empty result set. A caller that genuinely wants to tolerate a
 * failure can catch it, and will then be doing so deliberately.
 */
export async function inBatches<Row>(
  values: readonly string[],
  query: (
    batch: string[],
  ) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
  context = 'batched query',
): Promise<Row[]> {
  if (values.length === 0) return [];
  const out: Row[] = [];
  for (const batch of batchValues(values)) {
    const { data, error } = await query(batch);
    if (error) throw new Error(`${context} failed: ${error.message}`);
    if (data) out.push(...data);
  }
  return out;
}
