/**
 * Operator surface for the knowledge system.
 *
 * Admin-only, class-level (`@RequireRole('admin')` on the class, which
 * `RolesGuard` reads via `getAllAndOverride` — see roles.guard.ts for why the
 * class-level form was a fail-open bug once).
 *
 * The endpoints here answer the questions an operator actually has when
 * something is wrong, rather than exposing tables:
 *
 *   /status     is the corpus healthy, and how big is it
 *   /coverage   which routes can we answer about, and which cannot
 *   /sources    per-source freshness, indexing state and failures
 *   /jobs       what ran, what failed, what is stuck
 *   /quarantine what we refused to index and why
 *   /review     what needs a human
 *   /diff       what changed between two versions of a source
 *   /ingest     run the pipeline now, with a dry-run mode
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { JwtGuard, type AuthUser } from '../auth/jwt.guard';
import { RequireRole, RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { KnowledgeFreshnessService } from './knowledge-freshness.service';
import { KnowledgeIngestionService } from './knowledge-ingestion.service';
import {
  AdminListQueryDto,
  IngestSourceDto,
  ReviewActionDto,
} from './knowledge.dto';
import { diffVersions } from './version-diff';
import { inBatches } from './pg-batch';

@Controller('admin/knowledge')
@UseGuards(JwtGuard, RolesGuard)
@RequireRole('admin')
export class KnowledgeAdminController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly freshness: KnowledgeFreshnessService,
    private readonly ingestion: KnowledgeIngestionService,
  ) {}

  private get db() {
    // Admin reads span operational tables that grant no anon access and are
    // authenticated-read at most; the role check has already happened at the
    // guard. Service-role here is a system path, per the SupabaseService
    // contract, not a bypass of user scoping — none of these rows are
    // user-owned.
    return this.supabase.admin;
  }

  /** Corpus health in one payload: the page an operator opens first. */
  @Get('status')
  async status() {
    const [storage, jobs, quarantine, review, runs] = await Promise.all([
      this.db.from('kb_storage_stats').select('*').maybeSingle(),
      this.db.from('kb_ingestion_jobs').select('state').limit(5000),
      this.db.from('kb_quarantine').select('reason, resolved').limit(5000),
      this.db
        .from('kb_review_queue')
        .select('kind, severity, state')
        .limit(5000),
      this.db
        .from('visa_sync_runs')
        .select(
          'id, started_at, finished_at, status, sources_checked, changed_count, blocked_count',
        )
        .order('started_at', { ascending: false })
        .limit(5),
    ]);

    const jobRows = (jobs.data ?? []) as Array<{ state: string }>;
    const qRows = (quarantine.data ?? []) as Array<{
      reason: string;
      resolved: boolean;
    }>;
    const rRows = (review.data ?? []) as Array<{
      kind: string;
      severity: string;
      state: string;
    }>;

    const stats = (storage.data ?? {}) as Record<string, number>;
    const distinct = Number(stats.distinct_chunk_chars ?? 0);
    const naive = Number(stats.naive_chunk_chars ?? 0);

    return {
      storage: {
        ...stats,
        // The number that justifies the whole content-addressed design.
        chunkTextDeduplicationRatio:
          naive > 0 ? Number((1 - distinct / naive).toFixed(4)) : 0,
        blobCompressionRatio:
          Number(stats.blob_logical_bytes ?? 0) > 0
            ? Number(
                (
                  1 -
                  Number(stats.blob_stored_bytes ?? 0) /
                    Number(stats.blob_logical_bytes ?? 1)
                ).toFixed(4),
              )
            : 0,
      },
      jobs: countBy(jobRows, (j) => j.state),
      quarantine: {
        open: qRows.filter((q) => !q.resolved).length,
        byReason: countBy(
          qRows.filter((q) => !q.resolved),
          (q) => q.reason,
        ),
      },
      review: {
        open: rRows.filter((r) => r.state === 'open').length,
        bySeverity: countBy(
          rRows.filter((r) => r.state === 'open'),
          (r) => r.severity,
        ),
        byKind: countBy(
          rRows.filter((r) => r.state === 'open'),
          (r) => r.kind,
        ),
      },
      recentSyncRuns: runs.data ?? [],
    };
  }

  @Get('coverage')
  async coverage() {
    return this.freshness.coverageReport();
  }

  /**
   * Per-source operational view.
   *
   * Paginated by default. An operator screen over 400+ sources that returns
   * everything is a screen that gets slower every time a country is added.
   */
  @Get('sources')
  async sources(@Query() query: unknown) {
    const parsed = AdminListQueryDto.safeParse(query);
    if (!parsed.success)
      throw new BadRequestException(parsed.error.issues[0]?.message);
    const { country, limit = 100, offset = 0 } = parsed.data;

    let q = this.db
      .from('visa_sources')
      .select(
        'id, country_id, visa_type_id, role, authority, authority_rank, canonical_url, source_url, ' +
          'language, robots_state, redistribution, active, last_checked_at, last_success_at, ' +
          'last_changed_at, failure_streak, freshness_sla, visa_countries!inner(code, name)',
        { count: 'exact' },
      )
      .order('last_checked_at', { ascending: true, nullsFirst: true })
      .range(offset, offset + limit - 1);

    if (country) q = q.eq('visa_countries.code', country.toUpperCase());

    const { data, error, count } = await q;
    if (error) throw new BadRequestException(error.message);

    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
    const ids = rows.map((s) => String(s.id));
    const chunkCounts = await inBatches<{ source_id: string; status: string }>(
      ids,
      (b) =>
        this.db
          .from('kb_chunks')
          .select('source_id, status')
          .in('source_id', b),
      'source chunk count',
    );

    const indexed = new Map<string, number>();
    for (const c of chunkCounts) {
      if (c.status !== 'current') continue;
      indexed.set(c.source_id, (indexed.get(c.source_id) ?? 0) + 1);
    }

    return {
      total: count ?? 0,
      offset,
      limit,
      sources: rows.map((s) => ({
        ...s,
        indexedChunks: indexed.get(String(s.id)) ?? 0,
      })),
    };
  }

  @Get('jobs')
  async jobs(@Query() query: unknown) {
    const parsed = AdminListQueryDto.safeParse(query);
    if (!parsed.success)
      throw new BadRequestException(parsed.error.issues[0]?.message);
    const { state, limit = 100, offset = 0 } = parsed.data;

    let q = this.db
      .from('kb_ingestion_jobs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (state) q = q.eq('state', state);

    const { data, error, count } = await q;
    if (error) throw new BadRequestException(error.message);
    return { total: count ?? 0, offset, limit, jobs: data ?? [] };
  }

  @Get('quarantine')
  async quarantine(@Query() query: unknown) {
    const parsed = AdminListQueryDto.safeParse(query);
    if (!parsed.success)
      throw new BadRequestException(parsed.error.issues[0]?.message);
    const { limit = 100, offset = 0 } = parsed.data;

    const { data, error, count } = await this.db
      .from('kb_quarantine')
      .select('*', { count: 'exact' })
      .eq('resolved', false)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw new BadRequestException(error.message);
    return { total: count ?? 0, offset, limit, items: data ?? [] };
  }

  @Get('review')
  async review(@Query() query: unknown) {
    const parsed = AdminListQueryDto.safeParse(query);
    if (!parsed.success)
      throw new BadRequestException(parsed.error.issues[0]?.message);
    const {
      state = 'open',
      severity,
      kind,
      limit = 100,
      offset = 0,
    } = parsed.data;

    let q = this.db
      .from('kb_review_queue')
      .select('*', { count: 'exact' })
      .order('severity', { ascending: false })
      .order('last_seen_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (state !== 'all') q = q.eq('state', state);
    if (severity) q = q.eq('severity', severity);
    if (kind) q = q.eq('kind', kind);

    const { data, error, count } = await q;
    if (error) throw new BadRequestException(error.message);
    return { total: count ?? 0, offset, limit, items: data ?? [] };
  }

  @Post('review/:id')
  async actOnReview(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = ReviewActionDto.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(parsed.error.issues[0]?.message);

    const terminal =
      parsed.data.state === 'resolved' || parsed.data.state === 'dismissed';
    const { data, error } = await this.db
      .from('kb_review_queue')
      .update({
        state: parsed.data.state,
        resolution_note: parsed.data.note ?? null,
        resolved_by: terminal ? user.id : null,
        resolved_at: terminal ? new Date().toISOString() : null,
        assigned_to: parsed.data.state === 'acknowledged' ? user.id : null,
      })
      .eq('id', id)
      .select('id, state')
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('review item not found');
    return data;
  }

  /**
   * Semantic diff between two versions of a source.
   *
   * Structured, not a character diff: an operator deciding whether a change is
   * material needs "this requirement was removed" and "this fee went from 100
   * to 110", not a wall of red and green.
   */
  @Get('sources/:id/diff')
  async diff(
    @Param('id') sourceId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const { data: versions, error } = await this.db
      .from('visa_source_versions')
      .select('id, version_number, fetched_at, is_active')
      .eq('source_id', sourceId)
      .order('version_number', { ascending: false })
      .limit(20);
    if (error) throw new BadRequestException(error.message);

    const list = (versions ?? []) as Array<{
      id: string;
      version_number: number;
      is_active: boolean;
    }>;
    if (list.length < 2 && !(from && to)) {
      return {
        versions: list,
        diff: null,
        reason: 'need at least two versions to diff',
      };
    }

    const toId = to ?? list.find((v) => v.is_active)?.id ?? list[0]?.id;
    const fromId = from ?? list.find((v) => v.id !== toId)?.id;
    if (!toId || !fromId)
      throw new BadRequestException('could not resolve versions to diff');

    const { data: extractions } = await this.db
      .from('kb_extractions')
      .select('id, source_version_id, text')
      .in('source_version_id', [fromId, toId]);

    const rows = (extractions ?? []) as Array<{
      source_version_id: string;
      text: string;
    }>;
    const before = rows.find((r) => r.source_version_id === fromId)?.text;
    const after = rows.find((r) => r.source_version_id === toId)?.text;

    if (before === undefined || after === undefined) {
      return {
        versions: list,
        diff: null,
        reason:
          'one or both versions have no extraction — run ingestion for them first',
      };
    }

    return { versions: list, fromId, toId, diff: diffVersions(before, after) };
  }

  /**
   * Run ingestion now.
   *
   * `dryRun` reports the worklist without touching anything, which is what
   * makes this safe to point at a whole country. Without it, "ingest CA"
   * against a mistyped filter is a few hundred government requests.
   */
  @Post('ingest')
  async ingest(@Body() body: unknown) {
    const parsed = IngestSourceDto.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(parsed.error.issues[0]?.message);
    const dto = parsed.data;

    const versionIds = await this.resolveVersions(dto);
    if (dto.dryRun) {
      return {
        dryRun: true,
        wouldIngest: versionIds.length,
        sourceVersionIds: versionIds.slice(0, 100),
      };
    }

    const results = [];
    for (const id of versionIds) {
      results.push(
        await this.ingestion.ingestVersion(id, { force: dto.force }),
      );
    }

    return {
      requested: versionIds.length,
      ingested: results.filter((r) => r.status === 'ingested').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      quarantined: results.filter((r) => r.status === 'quarantined').length,
      failed: results.filter((r) => r.status === 'failed').length,
      chunks: results.reduce((n, r) => n + r.chunkCount, 0),
      embeddingsCreated: results.reduce((n, r) => n + r.embeddingsCreated, 0),
      embeddingsReused: results.reduce((n, r) => n + r.embeddingsReused, 0),
      results,
    };
  }

  /** Re-run the stale sweep and coverage gap detection on demand. */
  @Post('sweep')
  async sweep() {
    const stale = await this.freshness.sweepStale();
    const report = await this.freshness.coverageReport();
    const gaps = await this.freshness.raiseCoverageGaps(report);
    return { stale, coverageGapsRaised: gaps, coverage: report.totals };
  }

  private async resolveVersions(dto: IngestSourceDto): Promise<string[]> {
    if (dto.sourceVersionId) return [dto.sourceVersionId];

    if (dto.sourceId) {
      const { data } = await this.db
        .from('visa_source_versions')
        .select('id')
        .eq('source_id', dto.sourceId)
        .eq('is_active', true)
        .limit(1);
      return ((data ?? []) as Array<{ id: string }>).map((v) => v.id);
    }

    const { data: country } = await this.db
      .from('visa_countries')
      .select('id')
      .eq('code', dto.countryCode!.toUpperCase())
      .maybeSingle();
    if (!country)
      throw new NotFoundException(`country ${dto.countryCode} not found`);

    const { data: sources } = await this.db
      .from('visa_sources')
      .select('id')
      .eq('country_id', country.id)
      .eq('active', true);
    const sourceIds = ((sources ?? []) as Array<{ id: string }>).map(
      (s) => s.id,
    );
    if (sourceIds.length === 0) return [];

    const versions = await inBatches<{ id: string }>(
      sourceIds,
      (b) =>
        this.db
          .from('visa_source_versions')
          .select('id')
          .in('source_id', b)
          .eq('is_active', true),
      'ingest worklist lookup',
    );
    return versions.slice(0, dto.limit ?? 500).map((v) => v.id);
  }
}

function countBy<T>(
  rows: T[],
  key: (row: T) => string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = key(r);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
