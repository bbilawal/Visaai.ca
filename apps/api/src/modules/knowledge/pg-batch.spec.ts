import { batchSizeFor, batchValues } from './pg-batch';

/**
 * These tests exist because the module had none, and the thing it guards fails
 * silently and expensively. The numbers below are not taste — they come from
 * probing the production stack on 2026-09-04, recorded in the header of
 * pg-batch.ts: a 3752-byte URI answered 200 and a 3882-byte URI answered 502.
 */

const sha256 = (n: number) => n.toString(16).padStart(64, '0');
const uuid = (n: number) =>
  `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;

/**
 * The longest base URL any call site in this module builds, measured rather
 * than guessed: table, select list, an equality filter and the column name of
 * the `in` filter itself.
 */
const LONGEST_BASE =
  'https://api.example.supabase.co/rest/v1/kb_embeddings' +
  '?select=text_sha256&model=eq.text-embedding-3-small&text_sha256=in.()';

/** Where Kong starts answering 502 instead of returning rows. */
const OBSERVED_502_URI_BYTES = 3882;

function uriBytesFor(batch: string[]): number {
  const encoded = batch.map((v) => encodeURIComponent(v)).join(',');
  return LONGEST_BASE.length + encoded.length;
}

describe('batchSizeFor', () => {
  it('keeps a sha256 batch under the URI length that returns 502', () => {
    const values = Array.from({ length: 500 }, (_, i) => sha256(i));
    const [first] = batchValues(values);

    expect(uriBytesFor(first)).toBeLessThan(OBSERVED_502_URI_BYTES);
    // Margin, not a coincidence: the previous budget cleared the value list and
    // still overflowed once the base URL was added.
    expect(uriBytesFor(first)).toBeLessThan(2600);
  });

  it('keeps a uuid batch under the same ceiling, at a different count', () => {
    const values = Array.from({ length: 500 }, (_, i) => uuid(i));
    const [first] = batchValues(values);

    expect(uriBytesFor(first)).toBeLessThan(OBSERVED_502_URI_BYTES);
    // The point of sizing by bytes: shorter values must yield a bigger batch,
    // otherwise a count tuned for hashes wastes round trips on uuids.
    expect(first.length).toBeGreaterThan(
      batchValues(Array.from({ length: 500 }, (_, i) => sha256(i)))[0].length,
    );
  });

  it('never returns a batch size below one', () => {
    // A single value longer than the whole budget still has to be requested.
    expect(batchSizeFor(['x'.repeat(9000)])).toBeGreaterThanOrEqual(1);
    expect(batchSizeFor([])).toBeGreaterThanOrEqual(1);
  });
});

describe('batchValues', () => {
  it('covers every value exactly once, in order', () => {
    const values = Array.from({ length: 207 }, (_, i) => sha256(i));
    const batches = batchValues(values);

    expect(batches.flat()).toEqual(values);
    expect(new Set(batches.flat()).size).toBe(values.length);
  });

  it('returns nothing for an empty list rather than one empty request', () => {
    expect(batchValues([])).toEqual([]);
  });
});
