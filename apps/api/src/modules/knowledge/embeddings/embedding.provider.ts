/**
 * Embedding providers.
 *
 * A PORT, for the same reason `documents/ocr/` is one: the model that embeds
 * this corpus is an operational choice with cost, latency and data-residency
 * consequences, and business code must not name it. The schema already
 * enforces the other half of that — `kb_embeddings` is keyed by (text, model),
 * so two models coexist and a switch is a read-side change, not a migration.
 *
 * THE DIMENSION IS FIXED AT 1536 by the column type. Providers whose native
 * width differs must reduce to 1536 and say so in `dimensions`; a provider that
 * cannot is a schema change, deliberately, because silently truncating vectors
 * from a model that was not trained for it destroys the geometry that makes
 * retrieval work (`text-embedding-3-*` ARE trained for it — Matryoshka — and
 * that is why 1536 is a safe fixed width and not an arbitrary one).
 */
import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import OpenAI from 'openai';

export const EMBEDDING_DIMENSIONS = 1536;

export interface EmbeddingProvider {
  /** The exact model id written to `kb_embeddings.model`. */
  readonly model: string;
  readonly dimensions: number;
  /** Max input texts per request. */
  readonly batchSize: number;
  embed(texts: string[]): Promise<number[][]>;
}

export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

/** Longest input a single embedding call accepts, in characters. */
const MAX_INPUT_CHARS = 8000 * 4;

/**
 * OpenAI embeddings.
 *
 * Uses the `openai` SDK already in the API's dependencies rather than
 * LangChain's wrapper: this call has no chain, no callbacks and no streaming,
 * and going through `@langchain/openai` would route it through the metering
 * callback machinery built for chat completions, which reports token usage in
 * a shape embeddings do not produce.
 */
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = EMBEDDING_DIMENSIONS;
  readonly batchSize = 96;

  private readonly log = new Logger(OpenAiEmbeddingProvider.name);
  private client?: OpenAI;

  constructor(
    private readonly apiKey: string,
    readonly model = 'text-embedding-3-small',
    private readonly opts: { maxRetries?: number; timeoutMs?: number } = {},
  ) {}

  /**
   * Constructed on first use, not in the constructor: the provider is wired at
   * module init on every boot, and building an HTTP client for a process that
   * may never embed anything is wasted work.
   *
   * A STATIC import, not a dynamic one. `await import('openai')` resolves to
   * the module namespace under the CommonJS interop this project compiles to,
   * so `new (await import('openai')).default(...)` fails at runtime under
   * ts-node with "not constructable" — while `tsc --noEmit` accepts it. The
   * SDK is already a top-level import in ai.service.ts, so there is no load
   * cost to avoid here anyway.
   */
  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: this.apiKey,
        maxRetries: this.opts.maxRetries ?? 3,
        timeout: this.opts.timeoutMs ?? 60_000,
      });
    }
    return this.client;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const client = this.getClient();

    // Truncate rather than fail. A chunk over the model's context is a
    // chunker bug, but dropping the chunk loses a government requirement,
    // and the first 32k characters of an oversized chunk still embed usefully.
    const input = texts.map((t) => {
      if (t.length <= MAX_INPUT_CHARS) return t;
      this.log.warn(
        `chunk of ${t.length} chars truncated to ${MAX_INPUT_CHARS} for embedding`,
      );
      return t.slice(0, MAX_INPUT_CHARS);
    });

    const res = await client.embeddings.create({
      model: this.model,
      input,
      dimensions: this.dimensions,
    });

    // The API is documented to return results in input order, but the ordering
    // is what maps a vector to a chunk hash — getting it wrong attaches every
    // embedding to the wrong text, which no test of "did it return 1536
    // numbers" would catch. So sort by the index the API reports.
    const sorted = [...res.data].sort((a, b) => a.index - b.index);
    if (sorted.length !== input.length) {
      throw new Error(
        `embedding provider returned ${sorted.length} vectors for ${input.length} inputs`,
      );
    }
    return sorted.map((d) => d.embedding);
  }
}

/**
 * A deterministic, offline provider.
 *
 * NOT a toy. It is what makes the retrieval tests real tests: hybrid ranking,
 * jurisdiction isolation, RRF fusion and the superseded filter are all
 * properties of the pipeline, not of the model, and a test that needs a
 * network call to assert them is a test that does not run in CI.
 *
 * The vectors are hashed n-gram projections — the same text always produces
 * the same vector, and texts sharing vocabulary produce closer vectors, which
 * is enough signal for the ordering assertions the suite makes. It is
 * explicitly not good enough for production, and the model id says so, so a
 * corpus embedded with it can never be mistaken for a real one.
 */
export class DeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly model = 'deterministic-hash-v1';
  readonly dimensions = EMBEDDING_DIMENSIONS;
  readonly batchSize = 512;

  // eslint-disable-next-line @typescript-eslint/require-await
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => embedDeterministic(t, this.dimensions));
  }
}

/** Exported for tests that need the vector without constructing a provider. */
export function embedDeterministic(
  text: string,
  dimensions = EMBEDDING_DIMENSIONS,
): number[] {
  const vec = new Float64Array(dimensions);
  const tokens = text
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean);

  const addFeature = (feature: string, weight: number) => {
    const digest = createHash('sha1').update(feature).digest();
    // Two independent slots per feature, with a sign from a third byte, so
    // collisions cancel rather than always adding.
    for (let k = 0; k < 2; k++) {
      const idx =
        ((digest[k * 3] << 16) | (digest[k * 3 + 1] << 8) | digest[k * 3 + 2]) %
        dimensions;
      const sign = digest[k * 3 + 3] % 2 === 0 ? 1 : -1;
      vec[idx] += sign * weight;
    }
  };

  for (const token of tokens) addFeature(token, 1);
  // Bigrams give word order some weight, so "not required" and "required" are
  // not identical vectors.
  for (let i = 0; i + 1 < tokens.length; i++)
    addFeature(`${tokens[i]} ${tokens[i + 1]}`, 0.5);

  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec, (v) => v / norm);
}

/** Cosine similarity, for in-process reranking and tests. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('vector length mismatch');
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** Postgres `vector` literal. pgvector accepts `[1,2,3]`, not a JSON array of strings. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.map((v) => (Number.isFinite(v) ? v.toFixed(6) : '0')).join(',')}]`;
}
