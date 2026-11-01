/**
 * Retrieval.
 *
 * THE ONLY REQUIREMENT THAT MATTERS MORE THAN RELEVANCE IS ISOLATION.
 *
 * A retrieval system for a general corpus optimises recall: returning
 * something slightly off-topic costs a little quality. This corpus is not
 * general. Returning Australia's financial requirement for a question about
 * Canada does not degrade an answer, it produces a confidently wrong one about
 * money someone is about to move. The same is true across visa types within
 * one country — a visitor visa and a student visa have different document
 * lists, and the pages that describe them share most of their vocabulary,
 * which is exactly what makes dense retrieval mix them up.
 *
 * So the country and visa filters are applied inside the SQL, in both ranking
 * arms, and are not negotiable by a scoring heuristic. `kb_search_hybrid` does
 * that; this service is what decides the filters, picks the strategy, reranks
 * and logs.
 *
 * THREE STRATEGIES, chosen from the query rather than configured:
 *
 *   form_code  the question names an official form ('what is IMM 5257'). An
 *              exact GIN lookup on kb_chunks.form_codes. Dense retrieval is
 *              near-useless here — every Canadian form number embeds in the
 *              same place — so this arm runs FIRST and its hits are pinned.
 *   hybrid     the default: vector + lexical, RRF-fused.
 *   lexical    the fallback when no embedding provider is reachable. Degraded,
 *              and reported as such, rather than a failed request.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';

import { detectQueryFormCodes } from './form-codes';
import { queryHash } from './content-hash';
import {
  toVectorLiteral,
  type EmbeddingProvider,
} from './embeddings/embedding.provider';
import { rerank, type RerankSignal } from './rerank';
import { inBatches } from './pg-batch';
import { asText } from './row-values';

export interface RetrievalFilters {
  countryId?: string;
  visaTypeId?: string;
  /** ISO 3166-1 alpha-2 of the applicant's nationality, for rule-scoped ranking. */
  nationality?: string;
  /** Languages the user reads. A chunk in 'und' always passes. */
  languages?: string[];
  /** Ask about a past state of the rules. Defaults to today. */
  asOf?: string;
  /**
   * Include superseded content. Off by default and off in every user-facing
   * path: superseded text read as current is the failure mode the version
   * history exists to prevent, not a feature of it.
   */
  includeSuperseded?: boolean;
  sourceRoles?: string[];
}

export interface RetrievalOptions {
  limit?: number;
  candidateLimit?: number;
  /** Skip the retrieval log. Used by the benchmark harness, never by request paths. */
  skipLogging?: boolean;
  userId?: string;
  applicationId?: string;
}

export interface RetrievedChunk {
  chunkId: string;
  textSha256: string;
  text: string;
  score: number;
  vectorRank: number | null;
  lexicalRank: number | null;
  vectorSimilarity: number | null;
  lexicalScore: number | null;
  countryId: string;
  visaTypeId: string | null;
  sourceId: string;
  sourceVersionId: string;
  authorityRank: number;
  sourceRole: string;
  language: string;
  headingPath: string[];
  pageNumber: number | null;
  formCodes: string[];
  status: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  /** Filled by `hydrateCitations`. */
  citation?: ChunkCitation;
}

export interface ChunkCitation {
  url: string;
  authority: string;
  authorityRank: number;
  sourceRole: string;
  title: string | null;
  countryCode: string;
  countryName: string;
  visaTypeName: string | null;
  lastCheckedAt: string | null;
  lastChangedAt: string | null;
  versionNumber: number | null;
  publishedAt: string | null;
  pageNumber: number | null;
  /** True when the source is past its freshness SLA. */
  stale: boolean;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  strategy: 'hybrid' | 'lexical' | 'vector' | 'form_code';
  /** Set when the embedding arm was unavailable and results are lexical-only. */
  degraded?: string;
  candidateCount: number;
  latencyMs: number;
  retrievalId?: string;
  formCodes: string[];
}

/** Hard ceiling on what any caller can ask for in one query. */
const MAX_LIMIT = 50;

@Injectable()
export class KnowledgeRetrievalService {
  private readonly log = new Logger(KnowledgeRetrievalService.name);

  constructor(
    private readonly db: SupabaseClient,
    private readonly embeddings: EmbeddingProvider,
  ) {}

  async search(
    query: string,
    filters: RetrievalFilters = {},
    options: RetrievalOptions = {},
  ): Promise<RetrievalResult> {
    const startedAt = Date.now();
    const limit = Math.min(options.limit ?? 12, MAX_LIMIT);
    const candidateLimit = Math.min(options.candidateLimit ?? 120, 500);

    const trimmed = query.trim();
    if (!trimmed) {
      return {
        chunks: [],
        strategy: 'lexical',
        candidateCount: 0,
        latencyMs: Date.now() - startedAt,
        formCodes: [],
      };
    }

    const formCodes = detectQueryFormCodes(trimmed);

    // Embed. A provider outage degrades to lexical rather than failing: a
    // keyword answer with citations beats a 500 on a page about visa rules.
    let embedding: number[] | null = null;
    let degraded: string | undefined;
    try {
      const [vec] = await this.embeddings.embed([trimmed]);
      embedding = vec ?? null;
    } catch (err) {
      degraded = `embedding provider unavailable: ${err instanceof Error ? err.message : 'unknown'}`;
      this.log.warn(degraded);
    }

    const strategy: RetrievalResult['strategy'] =
      formCodes.length > 0 ? 'form_code' : embedding ? 'hybrid' : 'lexical';

    // FORM-CODE ARM. Runs first and independently, and its results are pinned
    // above the semantic ones. A user who typed a form number wants that form.
    const pinned: RetrievedChunk[] = [];
    if (formCodes.length > 0) {
      const exact = await this.callHybrid(trimmed, embedding, filters, {
        limit: Math.min(limit, 10),
        candidateLimit,
        formCodes,
      });
      pinned.push(...exact);
    }

    const semantic = await this.callHybrid(trimmed, embedding, filters, {
      limit: candidateLimit,
      candidateLimit,
    });

    // Merge, keeping the pinned order and dropping duplicates.
    const seen = new Set(pinned.map((c) => c.chunkId));
    const merged = [...pinned];
    for (const c of semantic) {
      if (!seen.has(c.chunkId)) {
        merged.push(c);
        seen.add(c.chunkId);
      }
    }

    const signals: RerankSignal = {
      query: trimmed,
      formCodes,
      visaTypeId: filters.visaTypeId,
      preferredLanguages: filters.languages,
      nationality: filters.nationality,
      pinnedChunkIds: new Set(pinned.map((c) => c.chunkId)),
    };
    const ranked = rerank(merged, signals).slice(0, limit);

    await this.hydrateCitations(ranked);

    const result: RetrievalResult = {
      chunks: ranked,
      strategy,
      degraded,
      candidateCount: merged.length,
      latencyMs: Date.now() - startedAt,
      formCodes,
    };

    if (!options.skipLogging) {
      result.retrievalId = await this.logRetrieval(
        trimmed,
        filters,
        options,
        result,
      );
    }

    return result;
  }

  /**
   * Call the SQL side.
   *
   * Note what is NOT done here: no post-filtering of results by country. The
   * filter is a parameter to the function so it applies before ranking. Doing
   * it here would mean a top-120 vector search over the whole corpus, of which
   * zero rows might be for the requested country.
   */
  private async callHybrid(
    query: string,
    embedding: number[] | null,
    filters: RetrievalFilters,
    opts: { limit: number; candidateLimit: number; formCodes?: string[] },
  ): Promise<RetrievedChunk[]> {
    // The generated types do not describe `kb_search_hybrid`, so `rpc()`
    // resolves to `any`. Narrowing here keeps the `any` from spreading into
    // every field read below, which the row mapper already guards with asText.
    const { data, error } = (await this.db.rpc('kb_search_hybrid', {
      p_query_text: query,
      p_query_embedding: embedding ? toVectorLiteral(embedding) : null,
      p_embedding_model: this.embeddings.model,
      p_country_id: filters.countryId ?? null,
      p_visa_type_id: filters.visaTypeId ?? null,
      p_languages: filters.languages?.length ? filters.languages : null,
      p_form_codes: opts.formCodes?.length ? opts.formCodes : null,
      p_include_superseded: filters.includeSuperseded ?? false,
      p_as_of: filters.asOf ?? null,
      p_limit: opts.limit,
      p_candidate_limit: opts.candidateLimit,
      p_rrf_k: 60,
    })) as unknown as {
      data: Array<Record<string, unknown>> | null;
      error: { message: string } | null;
    };

    if (error) throw new Error(`hybrid search failed: ${error.message}`);

    const rows = data ?? [];
    const mapped = rows.map(
      (r): RetrievedChunk => ({
        chunkId: asText(r.chunk_id),
        textSha256: asText(r.text_sha256),
        text: asText(r.chunk_text ?? ''),
        score: Number(r.score ?? 0),
        vectorRank:
          r.vector_rank === null || r.vector_rank === undefined
            ? null
            : Number(r.vector_rank),
        lexicalRank:
          r.lexical_rank === null || r.lexical_rank === undefined
            ? null
            : Number(r.lexical_rank),
        vectorSimilarity:
          r.vector_similarity === null || r.vector_similarity === undefined
            ? null
            : Number(r.vector_similarity),
        lexicalScore:
          r.lexical_score === null || r.lexical_score === undefined
            ? null
            : Number(r.lexical_score),
        countryId: asText(r.country_id),
        visaTypeId: r.visa_type_id ? asText(r.visa_type_id) : null,
        sourceId: asText(r.source_id),
        sourceVersionId: asText(r.source_version_id),
        authorityRank: Number(r.authority_rank ?? 5),
        sourceRole: asText(r.source_role ?? ''),
        language: asText(r.language ?? 'und'),
        headingPath: Array.isArray(r.heading_path)
          ? (r.heading_path as string[])
          : [],
        pageNumber:
          r.page_number === null || r.page_number === undefined
            ? null
            : Number(r.page_number),
        formCodes: Array.isArray(r.form_codes)
          ? (r.form_codes as string[])
          : [],
        status: asText(r.status ?? 'current'),
        effectiveFrom: r.effective_from ? asText(r.effective_from) : null,
        effectiveTo: r.effective_to ? asText(r.effective_to) : null,
      }),
    );

    // Role filter is applied here rather than in SQL because it is a
    // PREFERENCE, not a correctness boundary: a fee mentioned on a
    // requirements page is still the right fee. Applying it in SQL would drop
    // it entirely.
    if (filters.sourceRoles?.length) {
      const wanted = new Set(filters.sourceRoles);
      const preferred = mapped.filter((c) => wanted.has(c.sourceRole));
      if (preferred.length > 0)
        return [
          ...preferred,
          ...mapped.filter((c) => !wanted.has(c.sourceRole)),
        ];
    }
    return mapped;
  }

  /**
   * Attach the citation each chunk needs to be quotable.
   *
   * Batched by source, not per chunk: a page of results is usually three or
   * four distinct sources, and one query per chunk turns a 40 ms retrieval
   * into a 400 ms one.
   */
  async hydrateCitations(chunks: RetrievedChunk[]): Promise<void> {
    if (chunks.length === 0) return;

    const sourceIds = [...new Set(chunks.map((c) => c.sourceId))];
    const versionIds = [...new Set(chunks.map((c) => c.sourceVersionId))];
    const countryIds = [...new Set(chunks.map((c) => c.countryId))];
    const visaTypeIds = [
      ...new Set(chunks.map((c) => c.visaTypeId).filter(Boolean)),
    ] as string[];

    // Batched by bytes. A page of results is usually a handful of sources, but
    // `hydrateCitations` is also called by the admin and benchmark paths with
    // far larger sets, where an unbatched `.in()` overflows the request URI and
    // returns nothing — leaving every chunk without a citation.
    const [sources, versions, countries, visaTypes] = await Promise.all([
      inBatches<Record<string, unknown>>(
        sourceIds,
        (b) =>
          this.db
            .from('visa_sources')
            .select(
              'id, canonical_url, authority, authority_rank, role, title, last_checked_at, last_changed_at, freshness_sla',
            )
            .in('id', b),
        'citation source lookup',
      ),
      inBatches<Record<string, unknown>>(
        versionIds,
        (b) =>
          this.db
            .from('visa_source_versions')
            .select('id, version_number, published_at, fetched_at')
            .in('id', b),
        'citation version lookup',
      ),
      inBatches<Record<string, unknown>>(
        countryIds,
        (b) =>
          this.db.from('visa_countries').select('id, code, name').in('id', b),
        'citation country lookup',
      ),
      inBatches<Record<string, unknown>>(
        visaTypeIds,
        (b) =>
          this.db.from('visa_types').select('id, official_name').in('id', b),
        'citation visa type lookup',
      ),
    ]);

    const sourceById = new Map(sources.map((s) => [asText(s.id), s]));
    const versionById = new Map(versions.map((v) => [asText(v.id), v]));
    const countryById = new Map(countries.map((c) => [asText(c.id), c]));
    const visaTypeById = new Map(visaTypes.map((t) => [asText(t.id), t]));

    for (const chunk of chunks) {
      const s = sourceById.get(chunk.sourceId);
      const v = versionById.get(chunk.sourceVersionId);
      const c = countryById.get(chunk.countryId);
      const t = chunk.visaTypeId
        ? visaTypeById.get(chunk.visaTypeId)
        : undefined;

      const lastChecked = s?.last_checked_at ? asText(s.last_checked_at) : null;
      chunk.citation = {
        // ALWAYS the authority's canonical URL, never a cached copy. A citation
        // that points at VisaAI's own storage is not a citation — the reader
        // cannot verify it against the government.
        url: s?.canonical_url ? asText(s.canonical_url) : '',
        authority: s?.authority ? asText(s.authority) : 'unknown',
        authorityRank: chunk.authorityRank,
        sourceRole: chunk.sourceRole,
        title: s?.title ? asText(s.title) : null,
        countryCode: c?.code ? asText(c.code) : '',
        countryName: c?.name ? asText(c.name) : '',
        visaTypeName: t?.official_name ? asText(t.official_name) : null,
        lastCheckedAt: lastChecked,
        lastChangedAt: s?.last_changed_at ? asText(s.last_changed_at) : null,
        versionNumber: v?.version_number ? Number(v.version_number) : null,
        publishedAt: v?.published_at ? asText(v.published_at) : null,
        pageNumber: chunk.pageNumber,
        stale: isStale(
          lastChecked,
          s?.freshness_sla ? asText(s.freshness_sla) : null,
        ),
      };
    }
  }

  private async logRetrieval(
    query: string,
    filters: RetrievalFilters,
    options: RetrievalOptions,
    result: RetrievalResult,
  ): Promise<string | undefined> {
    const { data, error } = await this.db
      .from('kb_retrieval_logs')
      .insert({
        user_id: options.userId ?? null,
        application_id: options.applicationId ?? null,
        // Capped, and it is the query as searched. Retention rules apply.
        query_text: query.slice(0, 2000),
        query_hash: queryHash(query, filters as Record<string, unknown>),
        country_id: filters.countryId ?? null,
        visa_type_id: filters.visaTypeId ?? null,
        filters: {
          languages: filters.languages ?? null,
          includeSuperseded: filters.includeSuperseded ?? false,
          asOf: filters.asOf ?? null,
          sourceRoles: filters.sourceRoles ?? null,
          nationality: filters.nationality ?? null,
        },
        strategy: result.strategy,
        embedding_model: this.embeddings.model,
        candidate_count: result.candidateCount,
        returned_count: result.chunks.length,
        top_score: result.chunks[0]?.score ?? null,
        returned_chunk_ids: result.chunks.map((c) => c.chunkId),
        latency_ms: result.latencyMs,
        outcome:
          result.chunks.length > 0 ? 'answered' : 'insufficient_evidence',
      })
      .select('id')
      .single();

    if (error) {
      // Logging must never break retrieval.
      this.log.warn(`retrieval log insert failed: ${error.message}`);
      return undefined;
    }
    // Same `SupabaseClient<any>` caveat as everywhere else in this module.
    return asText((data as unknown as Record<string, unknown>).id) || undefined;
  }
}

/**
 * Is a source past its freshness SLA?
 *
 * Postgres serves an interval as either an ISO-8601 duration or a
 * `'30 days'`-style string depending on client settings, so both are parsed.
 * An unparseable interval reports NOT stale: flagging every citation stale
 * because of a formatting difference would train users to ignore the flag,
 * which is worse than not having it.
 */
export function isStale(
  lastCheckedAt: string | null,
  freshnessSla: string | null,
): boolean {
  if (!lastCheckedAt) return true;
  const ms = parseIntervalMs(freshnessSla);
  if (ms === null) return false;
  return Date.now() - Date.parse(lastCheckedAt) > ms;
}

export function parseIntervalMs(interval: string | null): number | null {
  if (!interval) return null;
  const DAY = 86_400_000;
  const HOUR = 3_600_000;
  const MINUTE = 60_000;

  // ISO-8601: P30D, PT6H
  const iso =
    /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
      interval,
    );
  if (iso) {
    const [, y, mo, d, h, mi, s] = iso;
    return (
      Number(y ?? 0) * 365 * DAY +
      Number(mo ?? 0) * 30 * DAY +
      Number(d ?? 0) * DAY +
      Number(h ?? 0) * HOUR +
      Number(mi ?? 0) * MINUTE +
      Number(s ?? 0) * 1000
    );
  }

  // Postgres verbose: '30 days', '6 hours', '1 mon 2 days'
  let total = 0;
  let matched = false;
  const re = /(\d+)\s*(year|mon|day|hour|min|sec)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(interval)) !== null) {
    matched = true;
    const n = Number(m[1]);
    switch (m[2].toLowerCase()) {
      case 'year':
        total += n * 365 * DAY;
        break;
      case 'mon':
        total += n * 30 * DAY;
        break;
      case 'day':
        total += n * DAY;
        break;
      case 'hour':
        total += n * HOUR;
        break;
      case 'min':
        total += n * MINUTE;
        break;
      case 'sec':
        total += n * 1000;
        break;
    }
  }
  // Bare 'HH:MM:SS' is how Postgres renders a sub-day interval.
  const clock = /^(\d+):(\d{2}):(\d{2})/.exec(interval.trim());
  if (clock) {
    matched = true;
    total +=
      Number(clock[1]) * HOUR +
      Number(clock[2]) * MINUTE +
      Number(clock[3]) * 1000;
  }
  return matched ? total : null;
}
