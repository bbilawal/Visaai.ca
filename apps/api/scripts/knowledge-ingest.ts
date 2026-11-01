/**
 * Backfill and re-index the visa knowledge corpus.
 *
 * The operational counterpart to `KnowledgeProcessor`: same services, no Nest
 * bootstrap (which refuses to boot outside production against production env),
 * so a corpus can be built or repaired from a shell.
 *
 * RESUMABLE BY DESIGN. Every unit is keyed in `kb_ingestion_jobs` by an
 * idempotency key derived from (version, embedding model), so a run killed at
 * item 4,000 of 12,000 restarts at 4,000. There is no separate checkpoint file
 * to get out of sync with the database.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... [OPENAI_API_KEY=...] \
 *     npx ts-node -P tsconfig.json scripts/knowledge-ingest.ts \
 *       [--country CA] [--source-id UUID] [--version-id UUID] \
 *       [--limit N] [--force] [--dry-run] [--concurrency N]
 *
 * Without OPENAI_API_KEY it runs the deterministic embedding provider, whose
 * model id (`deterministic-hash-v1`) is stored on every vector — a corpus built
 * that way can never be mistaken for a production one.
 */
import './lib/node20-websocket';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { ExtractorRegistry } from '../src/modules/knowledge/extract';
import { KnowledgeIngestionService } from '../src/modules/knowledge/knowledge-ingestion.service';
import {
  DeterministicEmbeddingProvider,
  OpenAiEmbeddingProvider,
  type EmbeddingProvider,
} from '../src/modules/knowledge/embeddings/embedding.provider';

interface Args {
  country?: string;
  sourceId?: string;
  versionId?: string;
  limit: number;
  force: boolean;
  dryRun: boolean;
  concurrency: number;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    country: get('--country')?.toUpperCase(),
    sourceId: get('--source-id'),
    versionId: get('--version-id'),
    limit: Number(get('--limit') ?? 500),
    force: argv.includes('--force'),
    dryRun: argv.includes('--dry-run'),
    // Bounded, and low by default. These runs share a process with nothing
    // else, but they DO share government hosts with the sync job — and the
    // embedding provider has its own rate limit.
    concurrency: Math.max(1, Math.min(Number(get('--concurrency') ?? 4), 16)),
  };
}

async function resolveWorklist(
  db: SupabaseClient,
  args: Args,
): Promise<string[]> {
  if (args.versionId) return [args.versionId];

  let sourceIds: string[] | null = null;

  if (args.sourceId) {
    sourceIds = [args.sourceId];
  } else if (args.country) {
    const { data: country } = await db
      .from('visa_countries')
      .select('id')
      .eq('code', args.country)
      .maybeSingle();
    if (!country)
      throw new Error(`country ${args.country} is not in the registry`);
    const { data: sources } = await db
      .from('visa_sources')
      .select('id')
      .eq('country_id', country.id)
      .eq('active', true);
    sourceIds = ((sources ?? []) as Array<{ id: string }>).map((s) => s.id);
    if (sourceIds.length === 0) return [];
  }

  let query = db
    .from('visa_source_versions')
    .select('id')
    .eq('is_active', true)
    .limit(args.limit);
  if (sourceIds) query = query.in('source_id', sourceIds);

  const { data, error } = await query;
  if (error) throw new Error(`could not list versions: ${error.message}`);
  return ((data ?? []) as Array<{ id: string }>).map((v) => v.id);
}

function buildProvider(): EmbeddingProvider {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || process.env.KNOWLEDGE_EMBEDDING_PROVIDER === 'deterministic') {
    console.warn(
      '[knowledge-ingest] no OPENAI_API_KEY — using the deterministic provider. ' +
        'The corpus this builds is for development and tests, not production.',
    );
    return new DeterministicEmbeddingProvider();
  }
  return new OpenAiEmbeddingProvider(
    apiKey,
    process.env.KNOWLEDGE_EMBEDDING_MODEL ?? 'text-embedding-3-small',
  );
}

/** Run `worker` over `items` with bounded concurrency, preserving input order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');

  const args = parseArgs(process.argv.slice(2));
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const versionIds = await resolveWorklist(db, args);
  if (versionIds.length === 0) {
    console.log(
      JSON.stringify(
        { requested: 0, note: 'nothing to ingest for that selector' },
        null,
        2,
      ),
    );
    return;
  }

  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          wouldIngest: versionIds.length,
          concurrency: args.concurrency,
          force: args.force,
          sample: versionIds.slice(0, 20),
        },
        null,
        2,
      ),
    );
    return;
  }

  const embeddings = buildProvider();
  const service = new KnowledgeIngestionService(
    db,
    new ExtractorRegistry(),
    embeddings,
  );

  const startedAt = Date.now();
  const latencies: number[] = [];
  let done = 0;

  const results = await mapWithConcurrency(
    versionIds,
    args.concurrency,
    async (id) => {
      const result = await service.ingestVersion(id, { force: args.force });
      latencies.push(result.durationMs);
      done++;
      if (done % 25 === 0 || done === versionIds.length) {
        process.stderr.write(
          `[knowledge-ingest] ${done}/${versionIds.length}\n`,
        );
      }
      return result;
    },
  );

  const by = (status: string) => results.filter((r) => r.status === status);
  const sorted = [...latencies].sort((a, b) => a - b);
  const pct = (p: number) =>
    sorted.length
      ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
      : 0;

  console.log(
    JSON.stringify(
      {
        embeddingModel: embeddings.model,
        requested: versionIds.length,
        ingested: by('ingested').length,
        skipped: by('skipped').length,
        quarantined: by('quarantined').length,
        failed: by('failed').length,
        chunks: results.reduce((n, r) => n + r.chunkCount, 0),
        sections: results.reduce((n, r) => n + r.sectionCount, 0),
        reusedChunkTexts: results.reduce((n, r) => n + r.reusedChunkTexts, 0),
        embeddingsCreated: results.reduce((n, r) => n + r.embeddingsCreated, 0),
        embeddingsReused: results.reduce((n, r) => n + r.embeddingsReused, 0),
        supersededChunks: results.reduce((n, r) => n + r.supersededChunks, 0),
        latencyMs: {
          p50: pct(0.5),
          p95: pct(0.95),
          max: sorted[sorted.length - 1] ?? 0,
        },
        wallClockMs: Date.now() - startedAt,
        failures: by('failed')
          .concat(by('quarantined'))
          .slice(0, 20)
          .map((r) => ({
            id: r.sourceVersionId,
            status: r.status,
            reason: r.reason,
          })),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
