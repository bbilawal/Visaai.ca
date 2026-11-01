/**
 * The background side of the knowledge system.
 *
 * Two jobs on one queue, discriminated by `job.name`:
 *
 *   'knowledge-ingest'  ingest a worklist of source versions
 *   'knowledge-sweep'   stale-source sweep + coverage gap detection
 *
 * Service-role client, like `VisaSyncProcessor` and for the same reason: every
 * `kb_*` table denies INSERT to every role, so the ingestion worker must bypass
 * RLS to be the only writer. That is the schema's design, not a workaround.
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Job } from 'bullmq';

import { KNOWLEDGE_QUEUE } from '../shared/queue/queue.constants';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { ExtractorRegistry } from './extract';
import { KnowledgeIngestionService } from './knowledge-ingestion.service';
import { KnowledgeFreshnessService } from './knowledge-freshness.service';
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProvider,
} from './embeddings/embedding.provider';
import { inBatches } from './pg-batch';

export interface IngestJobData {
  sourceVersionIds?: string[];
  countryCode?: string;
  force?: boolean;
  limit?: number;
}

export interface KnowledgeJobSummary {
  requested: number;
  ingested: number;
  skipped: number;
  quarantined: number;
  failed: number;
  chunks: number;
  embeddingsCreated: number;
  embeddingsReused: number;
  durationMs: number;
}

/**
 * Per-run ceiling on how many versions one job ingests.
 *
 * Bounded concurrency and bounded memory: each version holds its extracted
 * text and its chunks in memory while it is processed, and an unbounded
 * worklist against a 400-source corpus is an OOM waiting for a big PDF. The
 * remainder is picked up by the next scheduled run, which is the correct
 * behaviour for a job whose work only grows when governments publish.
 */
const MAX_PER_RUN = 200;

@Injectable()
@Processor(KNOWLEDGE_QUEUE)
export class KnowledgeProcessor extends WorkerHost {
  private readonly log = new Logger(KnowledgeProcessor.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly extractors: ExtractorRegistry,
    @Optional()
    @Inject(EMBEDDING_PROVIDER)
    private readonly embeddings?: EmbeddingProvider,
  ) {
    super();
  }

  async process(
    job: Job,
  ): Promise<
    KnowledgeJobSummary | { stale: number; raised: number; gaps: number }
  > {
    if (job.name === 'knowledge-sweep') return this.sweep();
    return this.ingest((job.data ?? {}) as IngestJobData);
  }

  private async sweep(): Promise<{
    stale: number;
    raised: number;
    gaps: number;
  }> {
    const freshness = new KnowledgeFreshnessService(this.supabase.admin);
    const stale = await freshness.sweepStale();
    const report = await freshness.coverageReport();
    const gaps = await freshness.raiseCoverageGaps(report);

    this.log.log(
      `knowledge sweep: ${stale.stale} stale source(s), ${gaps} coverage gap(s); ` +
        `corpus ${report.totals.chunks} chunks over ${report.totals.indexedSources} indexed source(s)`,
    );
    if (report.visaTypesWithoutAnySource.length > 0) {
      // A supported route with no source is a route the system must refuse on.
      // That is correct behaviour and a reportable gap, so it is logged loudly
      // rather than left to a dashboard nobody opens.
      this.log.warn(
        `${report.visaTypesWithoutAnySource.length} active visa type(s) have NO registered official ` +
          `source — the knowledge system will refuse every question about them.`,
      );
    }
    return { stale: stale.stale, raised: stale.raised, gaps };
  }

  private async ingest(data: IngestJobData): Promise<KnowledgeJobSummary> {
    const startedAt = Date.now();
    const summary: KnowledgeJobSummary = {
      requested: 0,
      ingested: 0,
      skipped: 0,
      quarantined: 0,
      failed: 0,
      chunks: 0,
      embeddingsCreated: 0,
      embeddingsReused: 0,
      durationMs: 0,
    };

    if (!this.embeddings) {
      // Explicit and loud. Chunking without embedding leaves a corpus that the
      // lexical arm can search and the vector arm cannot, which presents as
      // "retrieval quality collapsed" rather than as "nobody configured a
      // provider".
      this.log.error(
        'no embedding provider configured (KNOWLEDGE_EMBEDDING_PROVIDER); ingestion skipped',
      );
      summary.durationMs = Date.now() - startedAt;
      return summary;
    }

    const ingestion = new KnowledgeIngestionService(
      this.supabase.admin,
      this.extractors,
      this.embeddings,
    );

    const versionIds = (await this.resolveWorklist(data)).slice(
      0,
      data.limit ?? MAX_PER_RUN,
    );
    summary.requested = versionIds.length;

    for (const id of versionIds) {
      const result = await ingestion.ingestVersion(id, { force: data.force });
      switch (result.status) {
        case 'ingested':
          summary.ingested++;
          break;
        case 'skipped':
          summary.skipped++;
          break;
        case 'quarantined':
          summary.quarantined++;
          break;
        default:
          summary.failed++;
      }
      summary.chunks += result.chunkCount;
      summary.embeddingsCreated += result.embeddingsCreated;
      summary.embeddingsReused += result.embeddingsReused;
    }

    summary.durationMs = Date.now() - startedAt;
    this.log.log(
      `knowledge ingest: ${summary.ingested} ingested, ${summary.skipped} unchanged, ` +
        `${summary.quarantined} quarantined, ${summary.failed} failed; ` +
        `${summary.chunks} chunks, ${summary.embeddingsCreated} new embeddings ` +
        `(${summary.embeddingsReused} reused) in ${Math.round(summary.durationMs / 1000)}s`,
    );
    if (summary.quarantined > 0) {
      this.log.warn(
        `${summary.quarantined} source version(s) quarantined and NOT indexed. ` +
          `See kb_quarantine — these routes answer from older content or refuse.`,
      );
    }
    return summary;
  }

  /**
   * What to ingest.
   *
   * Priority order, and it is deliberate: explicitly requested versions first,
   * then queued re-index jobs (a government change already detected), then any
   * active version with no extraction (the backfill). A detected change must
   * never wait behind a backfill — the backfill is catching up on old content
   * and the change is a rule that moved this morning.
   */
  private async resolveWorklist(data: IngestJobData): Promise<string[]> {
    if (data.sourceVersionIds?.length) return data.sourceVersionIds;

    const db = this.supabase.admin;

    const { data: queued } = await db
      .from('kb_ingestion_jobs')
      .select('source_version_id')
      .eq('kind', 'reindex')
      .eq('state', 'queued')
      .order('created_at', { ascending: true })
      .limit(MAX_PER_RUN);
    const queuedIds = (
      (queued ?? []) as Array<{ source_version_id: string | null }>
    )
      .map((j) => j.source_version_id)
      .filter((id): id is string => Boolean(id));

    if (queuedIds.length >= MAX_PER_RUN) return queuedIds;

    let versionQuery = db
      .from('visa_source_versions')
      .select(
        'id, source_id, visa_sources!inner(country_id, active, visa_countries!inner(code))',
      )
      .eq('is_active', true)
      .eq('visa_sources.active', true)
      .limit(MAX_PER_RUN * 2);
    if (data.countryCode) {
      versionQuery = versionQuery.eq(
        'visa_sources.visa_countries.code',
        data.countryCode.toUpperCase(),
      );
    }

    const { data: versions } = await versionQuery;
    const candidateIds = ((versions ?? []) as Array<{ id: string }>).map(
      (v) => v.id,
    );
    if (candidateIds.length === 0) return queuedIds;

    // Only those with no extraction yet. Batched rather than per version: 400
    // round trips to decide a worklist is most of the run — but also not one
    // unbounded IN, which overflows the request URI and reads back as "nothing
    // is ingested", re-ingesting the whole corpus every night.
    const done = await inBatches<{ source_version_id: string }>(
      candidateIds,
      (b) =>
        db
          .from('kb_extractions')
          .select('source_version_id')
          .in('source_version_id', b),
      'worklist extraction lookup',
    );
    const haveExtraction = new Set(done.map((e) => e.source_version_id));

    const backfill = candidateIds.filter(
      (id) => !haveExtraction.has(id) && !queuedIds.includes(id),
    );
    return [...queuedIds, ...backfill];
  }
}
