/**
 * Freshness, change propagation and coverage.
 *
 * `visa-sync` already detects that a government page CHANGED and files a
 * promotion item. What it cannot do is answer the questions this layer creates:
 *
 *   - which chunks and embeddings does that change invalidate?
 *   - which cached answers cited them?
 *   - which supported visa types have no indexed source at all?
 *   - which sources are past the freshness SLA for their risk class?
 *
 * All four are answered here. The design principle throughout is INCREMENTAL:
 * a change to one fee page re-indexes that page, not the corpus. Re-embedding
 * 40,000 chunks because one PDF moved is both a bill and an outage window, and
 * it is the reason "just rebuild the index" is not an update strategy.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';

import { parseIntervalMs } from './knowledge-retrieval.service';
import { inBatches } from './pg-batch';
import { asText } from './row-values';

export interface DueSource {
  sourceId: string;
  sourceUrl: string;
  countryId: string;
  visaTypeId: string | null;
  role: string;
  lastCheckedAt: string | null;
  riskClass: string;
  checkIntervalMs: number;
}

export interface CoverageRow {
  countryId: string;
  countryCode: string;
  countryName: string;
  supportState: string;
  visaTypeId: string | null;
  visaTypeName: string | null;
  visaTypeSlug: string | null;
  sourceCount: number;
  indexedSourceCount: number;
  chunkCount: number;
  embeddedChunkCount: number;
  lastCheckedAt: string | null;
  staleSourceCount: number;
}

export interface CoverageReport {
  generatedAt: string;
  supportedCountries: number;
  supportedVisaTypes: number;
  visaTypesWithSources: number;
  visaTypesWithChunks: number;
  visaTypesWithoutAnySource: Array<{
    country: string;
    visaType: string;
    slug: string;
  }>;
  visaTypesWithSourcesButNoChunks: Array<{
    country: string;
    visaType: string;
    slug: string;
  }>;
  countriesWithoutAnySource: string[];
  rows: CoverageRow[];
  totals: {
    sources: number;
    indexedSources: number;
    chunks: number;
    embeddedChunks: number;
    staleSources: number;
  };
}

@Injectable()
export class KnowledgeFreshnessService {
  private readonly log = new Logger(KnowledgeFreshnessService.name);

  constructor(private readonly db: SupabaseClient) {}

  /**
   * Which sources are due a check, most overdue first.
   *
   * The interval comes from the freshness policy that matches most
   * specifically — visa type, then country, then source role, then the corpus
   * default — so a fee page is checked eight times as often as an archived
   * policy manual without either being hard-coded in the worker.
   */
  async dueSources(limit = 200, now = new Date()): Promise<DueSource[]> {
    const [{ data: policies }, { data: sources }] = await Promise.all([
      this.db
        .from('kb_freshness_policies')
        .select(
          'source_role, country_id, visa_type_id, risk_class, check_interval',
        )
        .eq('active', true),
      this.db
        .from('visa_sources')
        .select(
          'id, source_url, country_id, visa_type_id, role, last_checked_at, active',
        )
        .eq('active', true)
        .order('last_checked_at', { ascending: true, nullsFirst: true })
        .limit(limit * 4),
    ]);

    const policyRows = (policies ?? []) as Array<{
      source_role: string | null;
      country_id: string | null;
      visa_type_id: string | null;
      risk_class: string;
      check_interval: string;
    }>;

    const due: DueSource[] = [];
    for (const s of (sources ?? []) as Array<Record<string, unknown>>) {
      const policy = selectPolicy(policyRows, {
        role: asText(s.role ?? ''),
        countryId: asText(s.country_id ?? ''),
        visaTypeId: s.visa_type_id ? asText(s.visa_type_id) : null,
      });
      const intervalMs =
        parseIntervalMs(policy?.check_interval ?? null) ?? 86_400_000;
      const last = s.last_checked_at
        ? Date.parse(asText(s.last_checked_at))
        : 0;
      if (now.getTime() - last < intervalMs) continue;

      due.push({
        sourceId: asText(s.id),
        sourceUrl: asText(s.source_url),
        countryId: asText(s.country_id),
        visaTypeId: s.visa_type_id ? asText(s.visa_type_id) : null,
        role: asText(s.role ?? ''),
        lastCheckedAt: s.last_checked_at ? asText(s.last_checked_at) : null,
        riskClass: policy?.risk_class ?? 'standard',
        checkIntervalMs: intervalMs,
      });
      if (due.length >= limit) break;
    }
    return due;
  }

  /**
   * Propagate a detected source change into the knowledge layer.
   *
   * Called with a `visa_source_changes` row id after `visa-sync` files one.
   * What it does NOT do is publish: a material change stays behind the
   * registry's review gate, and the previously reviewed version keeps serving
   * until a human approves. This only makes the consequences visible and
   * queues the re-index.
   */
  async propagateChange(changeId: string): Promise<{
    affectedChunks: number;
    affectedVisaTypes: number;
    reviewRaised: boolean;
    reindexQueued: boolean;
  }> {
    const { data: change, error } = await this.db
      .from('visa_source_changes')
      .select(
        'id, source_id, from_version_id, to_version_id, classification, requires_review, summary, state',
      )
      .eq('id', changeId)
      .single();
    if (error || !change) throw new Error(`change ${changeId} not found`);

    const c = change as Record<string, unknown>;
    const sourceId = asText(c.source_id);
    const classification = asText(c.classification);
    const requiresReview = c.requires_review === true;

    const { data: source } = await this.db
      .from('visa_sources')
      .select('id, country_id, visa_type_id, role, canonical_url, authority')
      .eq('id', sourceId)
      .single();
    const s = (source ?? {}) as Record<string, unknown>;

    // Only the chunks of THIS source are touched. That is the incremental
    // guarantee: nothing else in the corpus is invalidated by one page moving.
    const { data: affected } = await this.db
      .from('kb_chunks')
      .select('id, visa_type_id')
      .eq('source_id', sourceId)
      .eq('status', 'current');
    const affectedRows = (affected ?? []) as Array<{
      id: string;
      visa_type_id: string | null;
    }>;
    const affectedVisaTypes = new Set(
      affectedRows.map((r) => r.visa_type_id).filter(Boolean),
    ).size;

    // Queue the re-index of the new version. Idempotency key is derived from
    // the version, so filing the same change twice queues one job.
    let reindexQueued = false;
    if (c.to_version_id) {
      const { error: jobErr } = await this.db.from('kb_ingestion_jobs').upsert(
        {
          idempotency_key: `reindex:${asText(c.to_version_id)}`,
          source_id: sourceId,
          source_version_id: asText(c.to_version_id),
          kind: 'reindex',
          state: 'queued',
          checkpoint: { changeId, classification },
        },
        { onConflict: 'idempotency_key', ignoreDuplicates: true },
      );
      reindexQueued = !jobErr;
    }

    // A cosmetic change re-indexes but raises nothing: the whole point of the
    // normalized hash is that a CSS refresh does not page anyone.
    let reviewRaised = false;
    if (
      classification === 'material' ||
      classification === 'structural' ||
      requiresReview
    ) {
      await this.raiseReview({
        kind: 'material_change',
        severity: classification === 'material' ? 'high' : 'medium',
        countryId: s.country_id ? asText(s.country_id) : undefined,
        visaTypeId: s.visa_type_id ? asText(s.visa_type_id) : undefined,
        sourceId,
        sourceChangeId: changeId,
        title: `${classification} change on ${asText(s.authority ?? 'official source')} (${asText(s.role ?? '')})`,
        detail:
          `${asText(c.summary ?? 'A monitored official page changed.')}\n\n` +
          `${affectedRows.length} indexed passage(s) across ${affectedVisaTypes || 1} visa route(s) ` +
          `are affected. The previously reviewed version keeps serving until this is approved.`,
        dedupeKey: `material_change:${changeId}`,
        evidence: {
          canonicalUrl: s.canonical_url ?? null,
          fromVersionId: c.from_version_id ?? null,
          toVersionId: c.to_version_id ?? null,
          affectedChunks: affectedRows.length,
        },
      });
      reviewRaised = true;
    }

    return {
      affectedChunks: affectedRows.length,
      affectedVisaTypes,
      reviewRaised,
      reindexQueued,
    };
  }

  /**
   * Sweep for stale sources and raise review items.
   *
   * Runs on the same schedule as the sync. A source that is stale for one day
   * bumps an occurrence counter on an existing row rather than creating a new
   * one — a persistent gap must not become a thousand tickets nobody reads.
   */
  async sweepStale(
    now = new Date(),
  ): Promise<{ stale: number; raised: number }> {
    const { data: policies } = await this.db
      .from('kb_freshness_policies')
      .select(
        'source_role, country_id, visa_type_id, risk_class, staleness_sla',
      )
      .eq('active', true);
    const policyRows = (policies ?? []) as Array<{
      source_role: string | null;
      country_id: string | null;
      visa_type_id: string | null;
      risk_class: string;
      staleness_sla: string;
    }>;

    const { data: sources } = await this.db
      .from('visa_sources')
      .select(
        'id, country_id, visa_type_id, role, canonical_url, authority, last_checked_at',
      )
      .eq('active', true);

    let stale = 0;
    let raised = 0;

    for (const s of (sources ?? []) as Array<Record<string, unknown>>) {
      const policy = selectPolicy(policyRows, {
        role: asText(s.role ?? ''),
        countryId: asText(s.country_id ?? ''),
        visaTypeId: s.visa_type_id ? asText(s.visa_type_id) : null,
      });
      const slaMs =
        parseIntervalMs(policy?.staleness_sla ?? null) ?? 30 * 86_400_000;
      const last = s.last_checked_at
        ? Date.parse(asText(s.last_checked_at))
        : 0;
      const age = now.getTime() - last;
      if (age <= slaMs) continue;

      stale++;
      const days = Math.floor(age / 86_400_000);
      await this.raiseReview({
        kind: 'stale_source',
        // A volatile source going stale is materially different from an
        // archived manual doing so: fees and forms change without notice.
        severity: policy?.risk_class === 'volatile' ? 'high' : 'medium',
        countryId: asText(s.country_id),
        visaTypeId: s.visa_type_id ? asText(s.visa_type_id) : undefined,
        sourceId: asText(s.id),
        title: `Source not verified for ${days} day(s): ${asText(s.authority ?? 'official source')}`,
        detail:
          `${asText(s.canonical_url ?? '')}\n` +
          `Risk class ${policy?.risk_class ?? 'standard'}; SLA ${policy?.staleness_sla ?? '30 days'}. ` +
          `Answers citing this source are flagged stale to users until it is re-verified.`,
        dedupeKey: `stale_source:${asText(s.id)}`,
      });
      raised++;
    }

    return { stale, raised };
  }

  /**
   * Coverage: every supported country and visa type, and whether the corpus
   * can actually answer about it.
   *
   * The two gap classes are deliberately reported separately because they have
   * different owners. "No source registered" is a research task — somebody has
   * to find the authority's page. "Sources registered but nothing indexed" is
   * an engineering task — the pipeline did not run, or quarantined everything.
   * Collapsing them into one "coverage gap" number is how a research backlog
   * gets mistaken for a broken pipeline.
   */
  async coverageReport(): Promise<CoverageReport> {
    const { data: countries } = await this.db
      .from('visa_countries')
      .select('id, code, name, support_state')
      .neq('support_state', 'unsupported');

    const countryRows = (countries ?? []) as Array<{
      id: string;
      code: string;
      name: string;
      support_state: string;
    }>;
    const countryIds = countryRows.map((c) => c.id);

    // The country list can be ~200 rows; unbatched that overflows the request
    // URI and returns nothing, which would report EVERY visa type as a
    // coverage gap. See pg-batch.ts.
    const [types, { data: sources }, { data: chunkAgg }] = await Promise.all([
      inBatches<Record<string, unknown>>(
        countryIds,
        (b) =>
          this.db
            .from('visa_types')
            .select('id, country_id, official_name, slug, lifecycle_state')
            .in('country_id', b),
        'coverage visa type lookup',
      ),
      this.db
        .from('visa_sources')
        .select(
          'id, country_id, visa_type_id, active, last_checked_at, freshness_sla',
        )
        .eq('active', true),
      this.db
        .from('kb_chunks')
        .select('source_id, country_id, visa_type_id, text_sha256, status'),
    ]);

    const typeRows = types.filter((t) => t.lifecycle_state === 'active');
    const sourceRows = (sources ?? []) as Array<Record<string, unknown>>;
    const chunkRows = (
      (chunkAgg ?? []) as Array<Record<string, unknown>>
    ).filter((c) => c.status === 'current');

    // Which chunk texts have a vector, so "indexed" means "retrievable" rather
    // than "chunked but never embedded" — a distinction that matters because
    // an unembedded chunk is invisible to the vector arm.
    const { data: embedded } = await this.db
      .from('kb_embeddings')
      .select('text_sha256');
    const embeddedShas = new Set(
      ((embedded ?? []) as Array<{ text_sha256: string }>).map(
        (e) => e.text_sha256,
      ),
    );

    const countryById = new Map(countryRows.map((c) => [c.id, c]));
    const sourcesWithChunks = new Set(
      chunkRows.map((c) => asText(c.source_id)),
    );

    const rows: CoverageRow[] = [];
    const gapsNoSource: Array<{
      country: string;
      visaType: string;
      slug: string;
    }> = [];
    const gapsNoChunks: Array<{
      country: string;
      visaType: string;
      slug: string;
    }> = [];

    const key = (countryId: string, visaTypeId: string | null) =>
      `${countryId}|${visaTypeId ?? ''}`;

    // Country-level sources apply to every route of the country, so they count
    // toward each route's coverage rather than being an unattributed row.
    const countryLevelSources = new Map<
      string,
      Array<Record<string, unknown>>
    >();
    const typeLevelSources = new Map<string, Array<Record<string, unknown>>>();
    for (const s of sourceRows) {
      const cid = asText(s.country_id);
      if (s.visa_type_id) {
        const k = key(cid, asText(s.visa_type_id));
        typeLevelSources.set(k, [...(typeLevelSources.get(k) ?? []), s]);
      } else {
        countryLevelSources.set(cid, [
          ...(countryLevelSources.get(cid) ?? []),
          s,
        ]);
      }
    }

    const now = Date.now();
    const isStaleSource = (s: Record<string, unknown>): boolean => {
      const slaMs =
        parseIntervalMs(s.freshness_sla ? asText(s.freshness_sla) : null) ??
        30 * 86_400_000;
      const last = s.last_checked_at
        ? Date.parse(asText(s.last_checked_at))
        : 0;
      return now - last > slaMs;
    };

    for (const t of typeRows) {
      const countryId = asText(t.country_id);
      const country = countryById.get(countryId);
      if (!country) continue;
      const typeId = asText(t.id);

      const applicable = [
        ...(typeLevelSources.get(key(countryId, typeId)) ?? []),
        ...(countryLevelSources.get(countryId) ?? []),
      ];
      const chunks = chunkRows.filter(
        (c) =>
          asText(c.country_id) === countryId &&
          (c.visa_type_id === null || asText(c.visa_type_id) === typeId),
      );
      const embeddedCount = chunks.filter((c) =>
        embeddedShas.has(asText(c.text_sha256)),
      ).length;
      const indexed = applicable.filter((s) =>
        sourcesWithChunks.has(asText(s.id)),
      );
      const lastChecked =
        applicable
          .map((s) => (s.last_checked_at ? asText(s.last_checked_at) : null))
          .filter((d): d is string => Boolean(d))
          .sort()
          .at(-1) ?? null;

      rows.push({
        countryId,
        countryCode: country.code,
        countryName: country.name,
        supportState: country.support_state,
        visaTypeId: typeId,
        visaTypeName: asText(t.official_name ?? ''),
        visaTypeSlug: asText(t.slug ?? ''),
        sourceCount: applicable.length,
        indexedSourceCount: indexed.length,
        chunkCount: chunks.length,
        embeddedChunkCount: embeddedCount,
        lastCheckedAt: lastChecked,
        staleSourceCount: applicable.filter(isStaleSource).length,
      });

      if (applicable.length === 0) {
        gapsNoSource.push({
          country: country.code,
          visaType: asText(t.official_name ?? ''),
          slug: asText(t.slug ?? ''),
        });
      } else if (chunks.length === 0) {
        gapsNoChunks.push({
          country: country.code,
          visaType: asText(t.official_name ?? ''),
          slug: asText(t.slug ?? ''),
        });
      }
    }

    const countriesWithSources = new Set(
      sourceRows.map((s) => asText(s.country_id)),
    );
    const countriesWithoutAnySource = countryRows
      .filter(
        (c) =>
          c.support_state === 'supported' && !countriesWithSources.has(c.id),
      )
      .map((c) => c.code);

    return {
      generatedAt: new Date().toISOString(),
      supportedCountries: countryRows.filter(
        (c) => c.support_state === 'supported',
      ).length,
      supportedVisaTypes: typeRows.length,
      visaTypesWithSources: rows.filter((r) => r.sourceCount > 0).length,
      visaTypesWithChunks: rows.filter((r) => r.chunkCount > 0).length,
      visaTypesWithoutAnySource: gapsNoSource,
      visaTypesWithSourcesButNoChunks: gapsNoChunks,
      countriesWithoutAnySource,
      rows,
      totals: {
        sources: sourceRows.length,
        indexedSources: sourcesWithChunks.size,
        chunks: chunkRows.length,
        embeddedChunks: chunkRows.filter((c) =>
          embeddedShas.has(asText(c.text_sha256)),
        ).length,
        staleSources: sourceRows.filter(isStaleSource).length,
      },
    };
  }

  /** File coverage gaps as review items so they are worked, not just reported. */
  async raiseCoverageGaps(report?: CoverageReport): Promise<number> {
    const r = report ?? (await this.coverageReport());
    let raised = 0;

    for (const gap of r.visaTypesWithoutAnySource) {
      await this.raiseReview({
        kind: 'coverage_gap',
        severity: 'high',
        title: `No official source registered: ${gap.country} ${gap.visaType}`,
        detail:
          'This visa type is listed as active but has no monitored official source, so the ' +
          'knowledge system cannot answer any question about it and must refuse. ' +
          'Register the authority page in visa_sources.',
        dedupeKey: `coverage_gap:no_source:${gap.country}:${gap.slug}`,
      });
      raised++;
    }

    for (const gap of r.visaTypesWithSourcesButNoChunks) {
      await this.raiseReview({
        kind: 'coverage_gap',
        severity: 'medium',
        title: `Sources registered but nothing indexed: ${gap.country} ${gap.visaType}`,
        detail:
          'Official sources exist for this route but produced no retrievable passages. ' +
          'Either ingestion has not run for them or every version was quarantined — ' +
          'check kb_ingestion_jobs and kb_quarantine.',
        dedupeKey: `coverage_gap:no_chunks:${gap.country}:${gap.slug}`,
      });
      raised++;
    }

    return raised;
  }

  private async raiseReview(input: {
    kind: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    title: string;
    detail?: string;
    dedupeKey: string;
    countryId?: string;
    visaTypeId?: string;
    sourceId?: string;
    sourceChangeId?: string;
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
        })
        .eq('id', (existing as { id: string }).id);
      return;
    }

    const { error } = await this.db.from('kb_review_queue').insert({
      kind: input.kind,
      severity: input.severity,
      // Explicit, not the column default: the dedupe read filters on `state`.
      state: 'open',
      occurrences: 1,
      country_id: input.countryId ?? null,
      visa_type_id: input.visaTypeId ?? null,
      source_id: input.sourceId ?? null,
      source_change_id: input.sourceChangeId ?? null,
      title: input.title.slice(0, 300),
      detail: input.detail?.slice(0, 8000) ?? null,
      evidence: input.evidence ?? {},
      dedupe_key: input.dedupeKey,
    });
    if (error && !/duplicate key/i.test(error.message)) {
      this.log.warn(`review insert failed: ${error.message}`);
    }
  }
}

/**
 * Most specific matching policy wins: visa type > country > role > default.
 *
 * Exported for the unit test, because "which policy applies" is the decision
 * that sets how often a government fee page is re-read, and getting it
 * backwards means the most volatile content is checked the least often.
 */
export function selectPolicy<
  T extends {
    source_role: string | null;
    country_id: string | null;
    visa_type_id: string | null;
  },
>(
  policies: T[],
  target: { role: string; countryId: string; visaTypeId: string | null },
): T | null {
  const score = (p: T): number => {
    if (p.visa_type_id && p.visa_type_id !== target.visaTypeId) return -1;
    if (p.country_id && p.country_id !== target.countryId) return -1;
    if (p.source_role && p.source_role !== target.role) return -1;
    return (
      (p.visa_type_id ? 4 : 0) +
      (p.country_id ? 2 : 0) +
      (p.source_role ? 1 : 0)
    );
  };

  let best: T | null = null;
  let bestScore = -1;
  for (const p of policies) {
    const s = score(p);
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  return bestScore >= 0 ? best : null;
}
