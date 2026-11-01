/**
 * The ingestion pipeline: an official source version becomes retrievable text.
 *
 * WHERE IT SITS. `visa-sync` already fetches every registered source daily,
 * hashes it, and writes a `visa_source_versions` row when the normalized text
 * changed. That row is the unit of work here. This service takes a version and
 * produces the extraction, sections, chunks and embeddings that make it
 * answerable — it does not decide WHAT to monitor (the registry does) or WHEN
 * (the scheduler does).
 *
 * EVERY STEP IS IDEMPOTENT, and each one is idempotent for a different reason:
 *
 *   blob      keyed by sha256 — writing the same bytes twice is one row
 *   extraction unique on (version, extractor, extractor_version) — re-running
 *              the same extractor on the same version finds the existing row
 *   chunk text keyed by sha256 — identical text across 300 pages is one row
 *   chunk      unique on (extraction, ordinal) — re-chunking upserts in place
 *   embedding  primary key (text_sha256, model) — never recomputed
 *
 * That is what makes the BullMQ retry policy safe. A worker killed halfway
 * through embedding restarts and re-does only the embeddings that are missing.
 *
 * TWO FETCH MODES, and the distinction exists because of a real operational
 * constraint. VisaAI was rate-limited by the European Commission in August by
 * scheduling two jobs against the same host in the same minute. So the normal
 * path REUSES the bytes `visa-sync` already downloaded (`body` passed in), and
 * only the backfill path fetches its own copy. Ingestion must not double the
 * egress against every government the platform monitors.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { gzipSync } from 'node:zlib';

import {
  DEFAULT_FETCH_POLICY,
  fetchSource,
  type FetchPolicy,
} from '../visa-sync/source-fetcher';
import { isAllowed } from '../visa-sync/robots';
import { ExtractorRegistry, ExtractionError } from './extract';
import { sniffMime, type SniffedType } from './mime';
import { redactSecrets, scanForInjection } from './content-safety';
import {
  chunkSections,
  DEFAULT_CHUNK_OPTIONS,
  estimateTokens,
  type ChunkOptions,
} from './chunking';
import { extractFormCodes } from './form-codes';
import { detectLanguage, normalizeLanguageTag } from './language';
import { hashBytes, hashText, jobKey } from './content-hash';
import { evaluateSource } from './source-policy';
import { inBatches } from './pg-batch';
import {
  toVectorLiteral,
  type EmbeddingProvider,
} from './embeddings/embedding.provider';
import { asText } from './row-values';

const STORAGE_BUCKET = 'visa-knowledge';

/** Above this, the stored blob is gzipped. Below it, compression costs more than it saves. */
const COMPRESS_ABOVE_BYTES = 4096;

export interface IngestOptions {
  /**
   * Bytes already downloaded by the caller. Supplying them is the normal path
   * and avoids a second request to a government host.
   */
  bytes?: Uint8Array;
  declaredContentType?: string | null;
  /** Re-extract and re-chunk even when an extraction already exists. */
  force?: boolean;
  chunkOptions?: ChunkOptions;
  fetchPolicy?: FetchPolicy;
  runId?: string;
}

export interface IngestResult {
  sourceVersionId: string;
  status: 'ingested' | 'skipped' | 'quarantined' | 'failed';
  reason?: string;
  blobSha256?: string;
  extractionId?: string;
  sectionCount: number;
  chunkCount: number;
  /** Chunk texts that were already in the corpus — the dedup saving. */
  reusedChunkTexts: number;
  embeddingsCreated: number;
  embeddingsReused: number;
  supersededChunks: number;
  warnings: string[];
  durationMs: number;
}

interface VersionRow {
  id: string;
  source_id: string;
  version_number: number;
  raw_sha256: string;
  normalized_sha256: string;
  content_type: string | null;
  published_at: string | null;
  effective_from: string | null;
  is_active: boolean;
  blob_sha256: string | null;
}

interface SourceRow {
  id: string;
  country_id: string;
  visa_type_id: string | null;
  source_url: string;
  canonical_url: string;
  role: string;
  authority: string;
  authority_rank: number;
  language: string;
  robots_state: string;
  redistribution: string;
}

interface CountryRow {
  id: string;
  code: string;
  immigration_authority_url: string | null;
  foreign_affairs_authority_url: string | null;
  official_visa_url: string | null;
  evisa_portal_url: string | null;
}

@Injectable()
export class KnowledgeIngestionService {
  private readonly log = new Logger(KnowledgeIngestionService.name);

  constructor(
    private readonly db: SupabaseClient,
    private readonly extractors: ExtractorRegistry,
    private readonly embeddings: EmbeddingProvider,
  ) {}

  /**
   * Ingest one source version.
   *
   * Never throws for an ordinary content problem — a bad PDF, a blocked host,
   * an injection-looking page. Those become a `quarantined` or `failed` result
   * and a `kb_quarantine` row, because one poisoned government page must not
   * take down the run that was going to index the other four hundred.
   */
  async ingestVersion(
    sourceVersionId: string,
    opts: IngestOptions = {},
  ): Promise<IngestResult> {
    const startedAt = Date.now();
    const result: IngestResult = {
      sourceVersionId,
      status: 'failed',
      sectionCount: 0,
      chunkCount: 0,
      reusedChunkTexts: 0,
      embeddingsCreated: 0,
      embeddingsReused: 0,
      supersededChunks: 0,
      warnings: [],
      durationMs: 0,
    };

    const job = await this.openJob(sourceVersionId, opts.runId);

    try {
      const { version, source, country } =
        await this.loadContext(sourceVersionId);

      // PROVENANCE GATE. The URL must belong to a host this jurisdiction's
      // registry already trusts. A row can be written to visa_sources by a
      // migration or an admin action; this is the check that a URL which got
      // in that way is still an official source before its text is quoted to
      // an applicant as government policy.
      const registeredHosts = await this.registeredHosts(country, source);
      // A country with nothing to compare against — no declared authority URL
      // and no other registered source — cannot be checked. That is the first
      // source of a newly onboarded country, and blocking it would make the
      // gate a barrier to onboarding rather than a provenance control. It is
      // allowed and flagged, so a human sees the unvalidated host.
      const verdict =
        registeredHosts.length === 0
          ? ({ allowed: true, unvalidated: true } as const)
          : evaluateSource(source.source_url, { registeredHosts });

      if ('unvalidated' in verdict) {
        result.warnings.push(
          `no other official host is registered for this country, so ${source.source_url} ` +
            `could not be validated against one`,
        );
        await this.raiseReview({
          kind: 'extraction_warning',
          severity: 'medium',
          countryId: country.id,
          sourceId: source.id,
          title: `Unvalidated source host for ${country.code}`,
          detail:
            `${source.source_url} is the only registered source for this country, so its host ` +
            `could not be checked against the authority's declared domains. Set ` +
            `visa_countries.immigration_authority_url so future sources are validated.`,
          dedupeKey: `unvalidated_host:${source.id}`,
        });
      } else if (!verdict.allowed) {
        return this.quarantine(result, job, {
          sourceId: source.id,
          sourceVersionId,
          reason: 'suspicious_content',
          detail: `source policy rejected ${source.source_url}: ${verdict.reason}`,
        });
      }

      // Already done, and not forced.
      if (!opts.force) {
        const existing = await this.findExtraction(sourceVersionId);
        if (existing) {
          result.status = 'skipped';
          result.reason =
            'extraction already exists for this extractor version';
          result.extractionId = existing.id;
          result.durationMs = Date.now() - startedAt;
          await this.closeJob(job, 'skipped', result);
          return result;
        }
      }

      const fetched = await this.obtainBytes(version, source, opts);
      if (fetched.kind === 'blocked') {
        return this.finishFailed(result, job, fetched.reason, startedAt);
      }
      const { bytes, declaredContentType } = fetched;

      // FORMAT. Sniffed from the bytes; the header is only what a mismatch is
      // measured against. See mime.ts for why trusting either alone fails.
      const sniff = sniffMime(bytes, declaredContentType);
      if (sniff.mismatch) {
        return this.quarantine(result, job, {
          sourceId: source.id,
          sourceVersionId,
          reason: 'mime_mismatch',
          detail: `served as ${sniff.declared} but the bytes are ${sniff.type}`,
        });
      }

      const blobSha = hashBytes(bytes);
      result.blobSha256 = blobSha;
      await this.storeBlob(blobSha, bytes, sniff.type, source.redistribution);
      await this.db
        .from('visa_source_versions')
        .update({ blob_sha256: blobSha })
        .eq('id', sourceVersionId);

      // EXTRACT
      let extracted;
      try {
        extracted = await this.extractors.extract({
          bytes,
          contentType: sniff.type,
          url: source.source_url,
          languageHint: source.language,
        });
      } catch (err) {
        const reason =
          err instanceof ExtractionError
            ? err.reason === 'encrypted'
              ? 'encrypted'
              : err.reason === 'no_text_layer'
                ? 'low_confidence'
                : 'extraction_failed'
            : 'extraction_failed';
        return this.quarantine(result, job, {
          sourceId: source.id,
          sourceVersionId,
          reason,
          detail: err instanceof Error ? err.message : String(err),
        });
      }

      // SAFETY. Redaction first so a secret never reaches the hash, the store,
      // the embedding provider or an admin screen; then the injection scan on
      // the redacted text.
      const redaction = redactSecrets(extracted.text);
      if (redaction.redacted.length > 0) {
        result.warnings.push(
          `redacted ${redaction.redacted.join(', ')} from source content`,
        );
      }
      const safety = scanForInjection(redaction.text);
      if (safety.quarantine) {
        return this.quarantine(result, job, {
          sourceId: source.id,
          sourceVersionId,
          reason: 'suspicious_content',
          detail:
            `injection score ${safety.score} over ${safety.findings.length} finding(s): ` +
            safety.findings
              .slice(0, 5)
              .map((f) => f.pattern)
              .join(', '),
          sample: safety.findings[0]?.excerpt,
        });
      }
      if (safety.findings.length > 0) {
        result.warnings.push(
          `${safety.findings.length} low-severity injection pattern(s) present; content fenced as data`,
        );
      }

      const cleanText = redaction.text;
      // Redaction can shift offsets, so the sections' text is re-derived from
      // the redacted document rather than trusted from the extractor.
      const sections = redaction.redacted.length
        ? extracted.sections.map((s) => ({
            ...s,
            text: redactSecrets(s.text).text,
          }))
        : extracted.sections;

      const lang = detectLanguage(cleanText, source.language);
      const language =
        lang.confidence >= 0.5
          ? lang.language
          : normalizeLanguageTag(source.language);
      if (lang.language !== 'und' && lang.confidence >= 0.5) {
        const declared = normalizeLanguageTag(source.language);
        if (lang.language !== declared.split('-')[0]) {
          // Not an error: the ministry genuinely served a different language.
          // Recorded so a language filter does not silently hide the document.
          result.warnings.push(
            `source declares ${declared} but content detected as ${lang.language} ` +
              `(confidence ${lang.confidence})`,
          );
        }
      }

      const textSha = hashText(cleanText);
      const extraction = await this.upsertExtraction({
        sourceVersionId,
        extractor: extracted.extractor,
        extractorVersion: extracted.extractorVersion,
        textSha256: textSha,
        text: cleanText,
        language,
        languageConfidence: lang.confidence,
        ocrApplied: extracted.ocrApplied,
        ocrConfidence: extracted.ocrConfidence,
        pageCount: extracted.pageCount,
        tableCount: extracted.tableCount,
        warnings: [...extracted.warnings, ...result.warnings],
      });
      result.extractionId = extraction.id;

      // SECTIONS. Replaced wholesale on a re-run: a partial overwrite would
      // leave sections from two different extractions interleaved.
      await this.db
        .from('kb_sections')
        .delete()
        .eq('extraction_id', extraction.id);
      if (sections.length > 0) {
        const rows = sections.map((s) => ({
          extraction_id: extraction.id,
          ordinal: s.ordinal,
          kind: s.kind,
          heading_path: s.headingPath,
          heading_level: s.headingLevel ?? null,
          page_number: s.pageNumber ?? null,
          char_start: s.charStart,
          char_end: s.charEnd,
          text: s.text,
          table_header: s.tableHeader ?? null,
        }));
        for (const batch of chunked(rows, 500)) {
          const { error } = await this.db.from('kb_sections').insert(batch);
          if (error) throw new Error(`section insert failed: ${error.message}`);
        }
      }
      result.sectionCount = sections.length;

      // CHUNK
      const chunks = chunkSections(
        sections,
        opts.chunkOptions ?? DEFAULT_CHUNK_OPTIONS,
      );
      const persisted = await this.persistChunks({
        chunks,
        extractionId: extraction.id,
        version,
        source,
        language,
        confidence: extracted.ocrApplied ? (extracted.ocrConfidence ?? 0.6) : 1,
      });
      result.chunkCount = persisted.chunkCount;
      result.reusedChunkTexts = persisted.reusedTexts;

      // EMBED
      const embedded = await this.embedMissing(persisted.textShas);
      result.embeddingsCreated = embedded.created;
      result.embeddingsReused = embedded.reused;

      // SUPERSEDE. Only after the new chunks are embedded and queryable, so
      // there is never a window where the old answer is gone and the new one
      // is not ready.
      if (version.is_active) {
        result.supersededChunks = await this.supersedePriorVersions(
          source.id,
          sourceVersionId,
        );
      }

      result.status = 'ingested';
      result.durationMs = Date.now() - startedAt;
      await this.closeJob(job, 'succeeded', result);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error(`ingest ${sourceVersionId} failed: ${message}`);
      return this.finishFailed(result, job, message, startedAt);
    }
  }

  // -------------------------------------------------------------------------
  // Context
  // -------------------------------------------------------------------------

  private async loadContext(sourceVersionId: string): Promise<{
    version: VersionRow;
    source: SourceRow;
    country: CountryRow;
  }> {
    const { data: version, error: vErr } = await this.db
      .from('visa_source_versions')
      .select(
        'id, source_id, version_number, raw_sha256, normalized_sha256, content_type, published_at, effective_from, is_active, blob_sha256',
      )
      .eq('id', sourceVersionId)
      .single();
    if (vErr || !version)
      throw new Error(`source version ${sourceVersionId} not found`);

    const { data: source, error: sErr } = await this.db
      .from('visa_sources')
      .select(
        'id, country_id, visa_type_id, source_url, canonical_url, role, authority, authority_rank, language, robots_state, redistribution',
      )
      .eq('id', version.source_id)
      .single();
    if (sErr || !source)
      throw new Error(`source ${version.source_id} not found`);

    const { data: country, error: cErr } = await this.db
      .from('visa_countries')
      .select(
        'id, code, immigration_authority_url, foreign_affairs_authority_url, official_visa_url, evisa_portal_url',
      )
      .eq('id', source.country_id)
      .single();
    if (cErr || !country)
      throw new Error(`country ${source.country_id} not found`);

    return {
      version: version,
      source: source,
      country: country,
    };
  }

  /**
   * The hosts this jurisdiction's registry already trusts.
   *
   * Derived, not written down: see source-policy.ts.
   *
   * THE ROW BEING CHECKED IS DELIBERATELY EXCLUDED. Including its own
   * `source_url` made the gate self-approving — every URL matched itself, so
   * the check passed unconditionally and a `visa_sources` row pointing at an
   * immigration blog would have been ingested and quoted as government policy.
   * A control that its own subject can satisfy is not a control.
   *
   * What it is checked AGAINST is the country's declared authority and portal
   * domains, plus the hosts of the OTHER sources already registered for that
   * country. The second half is what allows a genuinely multi-host authority —
   * GOV.UK's index and homeoffice.gov.uk's application pages — without a
   * hand-maintained per-country domain list.
   */
  private async registeredHosts(
    country: CountryRow,
    source: SourceRow,
  ): Promise<string[]> {
    const urls: Array<string | null> = [
      country.immigration_authority_url,
      country.foreign_affairs_authority_url,
      country.official_visa_url,
      country.evisa_portal_url,
    ];

    const { data: siblings } = await this.db
      .from('visa_sources')
      .select('id, canonical_url')
      .eq('country_id', country.id)
      .eq('active', true);

    for (const s of (siblings ?? []) as Array<{
      id: string;
      canonical_url: string;
    }>) {
      if (s.id === source.id) continue;
      urls.push(s.canonical_url);
    }

    const hosts: string[] = [];
    for (const u of urls) {
      if (!u) continue;
      try {
        hosts.push(new URL(u).hostname);
      } catch {
        /* a malformed registry URL is a registry problem, not a fetch one */
      }
    }
    return hosts;
  }

  private async obtainBytes(
    version: VersionRow,
    source: SourceRow,
    opts: IngestOptions,
  ): Promise<
    | { kind: 'ok'; bytes: Uint8Array; declaredContentType: string | null }
    | { kind: 'blocked'; reason: string }
  > {
    if (opts.bytes) {
      return {
        kind: 'ok',
        bytes: opts.bytes,
        declaredContentType:
          opts.declaredContentType ?? version.content_type ?? null,
      };
    }

    // Backfill path: our own fetch, and therefore our own robots check. A
    // source marked disallowed is never fetched again, per the registry's
    // policy — the correct response to robots.txt is to stop, not to retry.
    if (source.robots_state === 'disallowed') {
      return { kind: 'blocked', reason: 'robots.txt disallows this URL' };
    }

    const policy = opts.fetchPolicy ?? DEFAULT_FETCH_POLICY;

    if (source.robots_state !== 'allowed') {
      const robotsUrl = new URL('/robots.txt', source.source_url).toString();
      const robots = await fetchSource(robotsUrl, {
        ...policy,
        maxBytes: 512 * 1024,
      });
      const robotsText = robots.status === 'ok' ? robots.body : null;
      const verdict = isAllowed(
        robotsText,
        source.source_url,
        policy.userAgent,
      );
      if (!verdict.allowed) {
        await this.db
          .from('visa_sources')
          .update({ robots_state: 'disallowed' })
          .eq('id', source.id);
        return {
          kind: 'blocked',
          reason: `robots.txt disallows this URL (${verdict.matchedRule ?? 'rule'})`,
        };
      }
    }

    const outcome = await fetchSource(source.source_url, policy);
    if (outcome.status !== 'ok') {
      return {
        kind: 'blocked',
        reason:
          outcome.status === 'redirected'
            ? `source moved to ${outcome.redirectUrl}`
            : `fetch ${outcome.status}: ${'reason' in outcome ? outcome.reason : ''}`,
      };
    }
    return {
      kind: 'ok',
      bytes: outcome.bodyBytes,
      declaredContentType: outcome.contentType,
    };
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  /**
   * Store the bytes once, ever.
   *
   * The upload is skipped entirely when the authority's terms do not permit
   * redistribution: the hash and size still go in the row, which is enough to
   * detect change and to prove what was read, and the citation points at the
   * authority's own URL. That is the default posture, not a degraded one.
   */
  private async storeBlob(
    sha256: string,
    bytes: Uint8Array,
    contentType: SniffedType,
    redistribution: string,
  ): Promise<void> {
    const { data: existing } = await this.db
      .from('kb_blobs')
      .select('sha256, ref_count')
      .eq('sha256', sha256)
      .maybeSingle();

    if (existing) {
      await this.db
        .from('kb_blobs')
        .update({
          last_seen_at: new Date().toISOString(),
          ref_count: ((existing as { ref_count: number }).ref_count ?? 0) + 1,
        })
        .eq('sha256', sha256);
      return;
    }

    let storagePath: string | null = null;
    let compression: 'none' | 'gzip' = 'none';
    let storedBytes: number = bytes.byteLength;

    if (redistribution === 'permitted') {
      // Sharded by the first two hex characters: a single flat prefix with
      // hundreds of thousands of objects is slow to list in every storage
      // backend, and listing is what the lifecycle sweep does.
      const payload =
        bytes.byteLength > COMPRESS_ABOVE_BYTES
          ? gzipSync(Buffer.from(bytes))
          : Buffer.from(bytes);
      compression = payload.byteLength < bytes.byteLength ? 'gzip' : 'none';
      const body = compression === 'gzip' ? payload : Buffer.from(bytes);
      storedBytes = body.byteLength;
      storagePath = `${sha256.slice(0, 2)}/${sha256}${compression === 'gzip' ? '.gz' : ''}`;

      const { error } = await this.db.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, body, { contentType, upsert: true });
      if (error) {
        // A storage failure must not lose the extraction. The row is written
        // without a path, which is exactly the "metadata only" state.
        this.log.warn(
          `blob ${sha256} upload failed: ${error.message}; storing metadata only`,
        );
        storagePath = null;
        compression = 'none';
        storedBytes = 0;
      }
    }

    const { error } = await this.db.from('kb_blobs').insert({
      sha256,
      byte_size: bytes.byteLength,
      content_type: contentType,
      compression,
      stored_bytes: storagePath ? storedBytes : null,
      storage_path: storagePath,
      ref_count: 1,
    });
    // A concurrent worker inserting the same hash first is the dedup working,
    // not a failure.
    if (error && !/duplicate key/i.test(error.message)) {
      throw new Error(`blob insert failed: ${error.message}`);
    }
  }

  private async findExtraction(
    sourceVersionId: string,
  ): Promise<{ id: string } | null> {
    const { data } = await this.db
      .from('kb_extractions')
      .select('id')
      .eq('source_version_id', sourceVersionId)
      .limit(1)
      .maybeSingle();
    return data ?? null;
  }

  private async upsertExtraction(input: {
    sourceVersionId: string;
    extractor: string;
    extractorVersion: string;
    textSha256: string;
    text: string;
    language: string;
    languageConfidence: number;
    ocrApplied: boolean;
    ocrConfidence?: number;
    pageCount?: number;
    tableCount: number;
    warnings: string[];
  }): Promise<{ id: string }> {
    const row = {
      source_version_id: input.sourceVersionId,
      extractor: input.extractor,
      extractor_version: input.extractorVersion,
      text_sha256: input.textSha256,
      char_count: input.text.length,
      text: input.text,
      language: input.language,
      language_confidence: input.languageConfidence,
      ocr_applied: input.ocrApplied,
      ocr_confidence: input.ocrConfidence ?? null,
      page_count: input.pageCount ?? null,
      table_count: input.tableCount,
      warnings: input.warnings.slice(0, 50),
    };

    const { data, error } = await this.db
      .from('kb_extractions')
      .upsert(row, {
        onConflict: 'source_version_id,extractor,extractor_version',
      })
      .select('id')
      .single();
    if (error || !data)
      throw new Error(`extraction upsert failed: ${error?.message}`);
    return data;
  }

  /**
   * Write chunk texts (deduplicated) and chunk instances.
   *
   * Text goes in first and is keyed by its own hash, so a chunk whose text
   * already exists costs one conflict-ignored insert and no storage. That is
   * where the corpus-wide saving comes from: shared boilerplate across
   * hundreds of government pages is stored once.
   */
  private async persistChunks(input: {
    chunks: ReturnType<typeof chunkSections>;
    extractionId: string;
    version: VersionRow;
    source: SourceRow;
    language: string;
    confidence: number;
  }): Promise<{ chunkCount: number; reusedTexts: number; textShas: string[] }> {
    const { chunks, extractionId, version, source } = input;
    if (chunks.length === 0)
      return { chunkCount: 0, reusedTexts: 0, textShas: [] };

    const withHash = chunks.map((c) => ({ ...c, sha: hashText(c.text) }));
    const uniqueShas = [...new Set(withHash.map((c) => c.sha))];

    // Batched: a document with a few hundred distinct chunks overflows the
    // PostgREST request URI in one call, and the overflow reads as "nothing
    // exists" — see pg-batch.ts.
    const present = await inBatches<{ sha256: string }>(
      uniqueShas,
      (batch) =>
        this.db.from('kb_chunk_texts').select('sha256').in('sha256', batch),
      'chunk text lookup',
    );
    const existing = new Set(present.map((r) => r.sha256));

    const newTexts = withHash
      .filter(
        (c, i) =>
          !existing.has(c.sha) &&
          withHash.findIndex((x) => x.sha === c.sha) === i,
      )
      .map((c) => ({
        sha256: c.sha,
        text: c.text,
        char_count: c.text.length,
        token_estimate: estimateTokens(c.text),
      }));

    for (const batch of chunked(newTexts, 200)) {
      const { error } = await this.db
        .from('kb_chunk_texts')
        .upsert(batch, { onConflict: 'sha256', ignoreDuplicates: true });
      if (error) throw new Error(`chunk text insert failed: ${error.message}`);
    }

    // Section ids, so a chunk can point back at the structure it came from.
    const { data: sectionRows } = await this.db
      .from('kb_sections')
      .select('id, ordinal')
      .eq('extraction_id', extractionId);
    const sectionByOrdinal = new Map(
      ((sectionRows ?? []) as Array<{ id: string; ordinal: number }>).map(
        (s) => [s.ordinal, s.id],
      ),
    );

    const chunkRows = withHash.map((c, i) => ({
      extraction_id: extractionId,
      source_version_id: version.id,
      source_id: source.id,
      section_id: sectionByOrdinal.get(c.sectionOrdinal) ?? null,
      text_sha256: c.sha,
      ordinal: i,
      country_id: source.country_id,
      visa_type_id: source.visa_type_id,
      authority_rank: source.authority_rank,
      source_role: source.role,
      language: input.language,
      heading_path: c.headingPath,
      page_number: c.pageNumber ?? null,
      section_kind: c.sectionKind,
      form_codes: extractFormCodes(c.text).map((f) => f.code),
      effective_from: version.effective_from,
      effective_to: null,
      // A version that is not the active one is history the moment it is
      // written; it must never be served as current.
      status: version.is_active ? 'current' : 'superseded',
      confidence: input.confidence,
    }));

    // Replace rather than merge: a re-chunk with different boundaries would
    // otherwise leave orphans from the previous chunking at higher ordinals.
    await this.db.from('kb_chunks').delete().eq('extraction_id', extractionId);
    for (const batch of chunked(chunkRows, 300)) {
      const { error } = await this.db.from('kb_chunks').insert(batch);
      if (error) throw new Error(`chunk insert failed: ${error.message}`);
    }

    return {
      chunkCount: chunkRows.length,
      reusedTexts: uniqueShas.length - newTexts.length,
      textShas: uniqueShas,
    };
  }

  /**
   * Embed only what has no vector for the current model.
   *
   * The primary key on `kb_embeddings` already makes a duplicate impossible,
   * but the point of checking first is not correctness — it is cost. Every
   * skipped text is a paid API call not made, and on a re-ingest of an
   * unchanged page that is all of them.
   */
  private async embedMissing(
    textShas: string[],
  ): Promise<{ created: number; reused: number }> {
    if (textShas.length === 0) return { created: 0, reused: 0 };

    // Sized by bytes, not by a guessed count: an overflow here reads as "no
    // embedding exists" and silently re-embeds the whole document at cost.
    const present = await inBatches<{ text_sha256: string }>(
      textShas,
      (batch) =>
        this.db
          .from('kb_embeddings')
          .select('text_sha256')
          .eq('model', this.embeddings.model)
          .in('text_sha256', batch),
      'embedding lookup',
    );
    const have = new Set(present.map((r) => r.text_sha256));
    const missing = textShas.filter((sha) => !have.has(sha));

    if (missing.length === 0) return { created: 0, reused: textShas.length };

    let created = 0;
    // The provider's batch size caps the API call; pg-batch caps the URI. The
    // smaller of the two wins, which is why the read is batched separately
    // from the embed.
    for (const batch of chunked(missing, this.embeddings.batchSize)) {
      const rows = await inBatches<{ sha256: string; text: string }>(
        batch,
        (b) =>
          this.db.from('kb_chunk_texts').select('sha256, text').in('sha256', b),
        'chunk text read',
      );
      if (rows.length === 0) continue;

      const vectors = await this.embeddings.embed(rows.map((r) => r.text));
      const payload = rows.map((r, i) => ({
        text_sha256: r.sha256,
        model: this.embeddings.model,
        dimensions: this.embeddings.dimensions,
        embedding: toVectorLiteral(vectors[i]),
      }));

      const { error: insErr } = await this.db
        .from('kb_embeddings')
        .upsert(payload, {
          onConflict: 'text_sha256,model',
          ignoreDuplicates: true,
        });
      if (insErr) throw new Error(`embedding insert failed: ${insErr.message}`);
      created += payload.length;
    }

    return { created, reused: textShas.length - missing.length };
  }

  /**
   * Mark chunks from earlier versions of the same source superseded.
   *
   * Not deleted. "What did the rule say before the change" is a question this
   * corpus must be able to answer — it is how a change diff is validated and
   * how an applicant who acted on the old rule can be told what moved — and
   * because deleting the only copy of a source we once served destroys the
   * audit trail the whole registry exists to keep.
   */
  private async supersedePriorVersions(
    sourceId: string,
    currentVersionId: string,
  ): Promise<number> {
    const { data, error } = await this.db
      .from('kb_chunks')
      .update({ status: 'superseded', superseded_at: new Date().toISOString() })
      .eq('source_id', sourceId)
      .eq('status', 'current')
      .neq('source_version_id', currentVersionId)
      .select('id');
    if (error) {
      this.log.warn(
        `supersede failed for source ${sourceId}: ${error.message}`,
      );
      return 0;
    }
    return (data ?? []).length;
  }

  // -------------------------------------------------------------------------
  // Job bookkeeping
  // -------------------------------------------------------------------------

  private async openJob(
    sourceVersionId: string,
    runId?: string,
  ): Promise<string | null> {
    const key = jobKey('ingest', sourceVersionId, this.embeddings.model);
    const { data, error } = await this.db
      .from('kb_ingestion_jobs')
      .upsert(
        {
          idempotency_key: key,
          source_version_id: sourceVersionId,
          kind: 'extract',
          state: 'running',
          started_at: new Date().toISOString(),
          run_id: runId ?? null,
        },
        { onConflict: 'idempotency_key' },
      )
      .select('id')
      .single();
    if (error || !data) {
      // Bookkeeping must never be the reason ingestion fails.
      this.log.warn(
        `could not open ingestion job for ${sourceVersionId}: ${error?.message}`,
      );
      return null;
    }
    // `SupabaseClient` is `SupabaseClient<any>` here (DEBT-001 / RT-026), so
    // `data` is `any` and reading `.id` off it is an unchecked assertion.
    // Narrow it the way the rest of this module does.
    return asText((data as unknown as Record<string, unknown>).id) || null;
  }

  private async closeJob(
    jobId: string | null,
    state: 'succeeded' | 'failed' | 'skipped' | 'quarantined',
    result: IngestResult,
  ): Promise<void> {
    if (!jobId) return;
    await this.db
      .from('kb_ingestion_jobs')
      .update({
        state,
        finished_at: new Date().toISOString(),
        error_message: result.reason?.slice(0, 4000) ?? null,
        stats: {
          sections: result.sectionCount,
          chunks: result.chunkCount,
          reusedChunkTexts: result.reusedChunkTexts,
          embeddingsCreated: result.embeddingsCreated,
          embeddingsReused: result.embeddingsReused,
          supersededChunks: result.supersededChunks,
          durationMs: result.durationMs,
          warnings: result.warnings.slice(0, 20),
        },
      })
      .eq('id', jobId);
  }

  private async quarantine(
    result: IngestResult,
    jobId: string | null,
    input: {
      sourceId: string;
      sourceVersionId: string;
      reason: string;
      detail: string;
      sample?: string;
    },
  ): Promise<IngestResult> {
    await this.db.from('kb_quarantine').insert({
      source_id: input.sourceId,
      source_version_id: input.sourceVersionId,
      reason: input.reason,
      detail: input.detail.slice(0, 4000),
      sample: input.sample?.slice(0, 2000) ?? null,
    });

    await this.raiseReview({
      kind: 'extraction_warning',
      // Suspicious content is the one quarantine reason that could be an
      // attack rather than a broken file, so it pages higher.
      severity: input.reason === 'suspicious_content' ? 'high' : 'medium',
      sourceId: input.sourceId,
      title: `Source quarantined: ${input.reason}`,
      detail: input.detail,
      dedupeKey: `quarantine:${input.sourceId}:${input.reason}`,
    });

    this.log.warn(
      `quarantined version ${input.sourceVersionId}: ${input.reason} — ${input.detail}`,
    );
    result.status = 'quarantined';
    result.reason = `${input.reason}: ${input.detail}`;
    await this.closeJob(jobId, 'quarantined', result);
    return result;
  }

  private async finishFailed(
    result: IngestResult,
    jobId: string | null,
    reason: string,
    startedAt: number,
  ): Promise<IngestResult> {
    result.status = 'failed';
    result.reason = reason;
    result.durationMs = Date.now() - startedAt;
    await this.closeJob(jobId, 'failed', result);
    return result;
  }

  /** Raise or refresh a review item. Recurrence bumps a counter, not a new row. */
  async raiseReview(input: {
    kind: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    title: string;
    detail?: string;
    dedupeKey: string;
    countryId?: string;
    visaTypeId?: string;
    sourceId?: string;
    evidence?: Record<string, unknown>;
  }): Promise<void> {
    const { data: existing } = await this.db
      .from('kb_review_queue')
      .select('id, occurrences')
      .eq('dedupe_key', input.dedupeKey)
      .in('state', ['open', 'acknowledged'])
      .maybeSingle();

    if (existing) {
      await this.db
        .from('kb_review_queue')
        .update({
          occurrences:
            ((existing as { occurrences: number }).occurrences ?? 1) + 1,
          last_seen_at: new Date().toISOString(),
          detail: input.detail?.slice(0, 8000) ?? null,
        })
        .eq('id', (existing as { id: string }).id);
      return;
    }

    const { error } = await this.db.from('kb_review_queue').insert({
      kind: input.kind,
      severity: input.severity,
      // Set explicitly rather than left to the column default. The dedupe read
      // above filters on `state`, so a row inserted without one is invisible
      // to it and every recurrence creates another ticket.
      state: 'open',
      occurrences: 1,
      country_id: input.countryId ?? null,
      visa_type_id: input.visaTypeId ?? null,
      source_id: input.sourceId ?? null,
      title: input.title.slice(0, 300),
      detail: input.detail?.slice(0, 8000) ?? null,
      evidence: input.evidence ?? {},
      dedupe_key: input.dedupeKey,
    });
    if (error && !/duplicate key/i.test(error.message)) {
      this.log.warn(`review item insert failed: ${error.message}`);
    }
  }
}

/** Split into batches. Supabase rejects very large single statements. */
export function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}
