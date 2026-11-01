import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { pageRows } from '../shared/supabase/page-rows';
import { parseIntervalMs } from '../knowledge/knowledge-retrieval.service';
import { asTextOrNull } from '../knowledge/row-values';

/**
 * The operational state of the visa registry, for §74's "authorized admins
 * need visibility into ... stale sources, sync failures, material changes,
 * pending reviews, provenance, parsing failures".
 *
 * WHY THIS EXISTS
 *
 * The safe change-promotion workflow is draft → review → active. A material
 * change files a new version WITHOUT activating it, and the previous version
 * keeps serving until a person reviews it. That design is sound and it is
 * tested — but until now there was no surface anywhere in the product for the
 * person it depends on. 125 changes sat in production flagged requires_review
 * with reviewed_at null, reachable only by connecting to the database directly,
 * which is precisely what §74's closing line ("avoid routine direct production
 * database edits") exists to prevent.
 *
 * A gate with no gatekeeper is not a gate. This is read-only: it shows what is
 * waiting and why. Acting on a review still goes through the promotion path,
 * because a screen that could activate a version with one click would turn the
 * queue back into decoration.
 */

export interface PendingChange {
  id: string;
  sourceUrl: string;
  authority: string | null;
  country: string | null;
  classification: string;
  escalationReasons: string[];
  summary: string;
  addedTotal: number;
  removedTotal: number;
  /**
   * True when the previous version's text was never retained, so the diff could
   * not be computed (B-29). Surfaced rather than hidden: a reviewer needs to
   * know they are being told "something changed" and not what.
   */
  unattributable: boolean;
  detectedAt: string;
}

export interface RegistryOps {
  generatedAt: string;
  registry: {
    countriesTotal: number;
    countriesPublishable: number;
    countriesBaselineOnly: number;
    visaTypesActive: number;
    requirementsActive: number;
    publishablePages: number;
  };
  provenance: {
    /** Requirements published without a source version or an excerpt. Must be 0. */
    requirementsWithoutProvenance: number;
    activeSourceVersions: number;
    versionsRetainingText: number;
  };
  sources: {
    total: number;
    blocked: number;
    staleBeyondSla: number;
  };
  lastRun: {
    startedAt: string | null;
    sourcesChecked: number;
    ok: number;
    changed: number;
    blocked: number;
    unavailable: number;
    parseErrors: number;
    clientRendered: number;
  } | null;
  reviews: {
    awaiting: number;
    unattributable: number;
    items: PendingChange[];
  };
}

@Injectable()
export class RegistryOpsService {
  constructor(private readonly supabase: SupabaseService) {}

  /** Cap on the review list. The counts above it are exact; this is the page. */
  static readonly REVIEW_PAGE = 50;

  async get(): Promise<RegistryOps> {
    const db = this.supabase.admin;

    // REGOPS-001: surface read failures instead of reporting zero.
    //
    // Every query in this method discarded its `error` and fell back to a zero
    // or an empty list. supabase-js RESOLVES a database error as `{ error }`
    // rather than rejecting, so a failed read did not throw — it rendered a
    // flawless dashboard: zero stale sources, zero blocked sources, zero
    // requirements missing provenance, zero changes awaiting review. On a page
    // whose own comment says of provenance defects "the only acceptable answer
    // is zero", the failure mode was indistinguishable from the success signal,
    // and the worse the outage the healthier the page looked.
    //
    // The route's consumer already renders "Could not load registry state" from
    // a thrown error; it simply never got one. Same treatment the executive
    // dashboard's `count` helper already applies.
    const count = async (
      table: string,
      apply: (q: any) => any = (q) => q,
    ): Promise<number> => {
      const { count: n, error } = await apply(
        db.from(table).select('id', { count: 'exact', head: true }),
      );
      if (error) throw error;
      return n ?? 0;
    };

    const [
      countriesTotal,
      countriesPublishable,
      visaTypesActive,
      requirementsActive,
      publishablePages,
      sourcesTotal,
      sourcesBlocked,
      activeVersions,
      versionsWithText,
      awaiting,
    ] = await Promise.all([
      count('visa_countries'),
      // 'supported' STRICTLY. `neq('unsupported')` also counted 'preview',
      // which the schema defines as "data exists but is incomplete; not
      // offered in the picker" — and which the `visa_publishable_pages` view
      // this page reports on excludes with `where c.support_state =
      // 'supported'`. Counting preview here overstated publishable countries
      // and understated `countriesBaselineOnly`, which is derived from it.
      count('visa_countries', (q) => q.eq('support_state', 'supported')),
      count('visa_types', (q) => q.eq('lifecycle_state', 'active')),
      count('visa_requirements', (q) => q.eq('status', 'active')),
      count('visa_publishable_pages'),
      count('visa_sources'),
      count('visa_sources', (q) => q.gte('failure_streak', 3)),
      count('visa_source_versions', (q) => q.eq('is_active', true)),
      count('visa_source_versions', (q) =>
        q.not('normalized_text', 'is', null),
      ),
      count('visa_source_changes', (q) =>
        q.eq('requires_review', true).is('reviewed_at', null),
      ),
    ]);

    // Provenance is asked as a defect count, not a coverage percentage. The
    // number that matters is how many published requirements lack the evidence
    // they are supposed to be bound to, and the only acceptable answer is zero.
    const { count: withoutProvenance, error: provErr } = await db
      .from('visa_requirements')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .or('source_version_id.is.null,source_excerpt.is.null');
    if (provErr) throw provErr;

    const { data: runRow, error: runErr } = await db
      .from('visa_sync_runs')
      .select(
        'started_at, sources_checked, ok_count, changed_count, blocked_count, ' +
          'unavailable_count, parse_error_count, client_rendered_count',
      )
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (runErr) throw runErr;

    const { data: changeRows, error: changeErr } = await db
      .from('visa_source_changes')
      .select(
        'id, classification, escalation_reasons, summary, diff, created_at, ' +
          'visa_sources(source_url, authority, visa_countries(name))',
      )
      .eq('requires_review', true)
      .is('reviewed_at', null)
      .order('created_at', { ascending: false })
      .limit(RegistryOpsService.REVIEW_PAGE);
    if (changeErr) throw changeErr;

    const items: PendingChange[] = ((changeRows ?? []) as any[]).map((r) => {
      const src = Array.isArray(r.visa_sources)
        ? r.visa_sources[0]
        : r.visa_sources;
      const country = src?.visa_countries;
      return {
        id: r.id,
        sourceUrl: src?.source_url ?? '—',
        authority: src?.authority ?? null,
        country: (Array.isArray(country) ? country[0] : country)?.name ?? null,
        classification: r.classification,
        escalationReasons: r.escalation_reasons ?? [],
        summary: r.summary ?? '',
        addedTotal: Number(r.diff?.added_total ?? 0),
        removedTotal: Number(r.diff?.removed_total ?? 0),
        unattributable: r.diff?.unattributable === true,
        detectedAt: r.created_at,
      };
    });

    // Stale is computed from each source's own SLA rather than one global
    // number, because a fees page and a policy page do not go stale at the
    // same rate and averaging them would hide both.
    //
    // KNOWN BOUND: this pulls every active source into memory and filters in
    // JS. Measured at 235 sources it costs 0.5ms, so §68's rule — optimise on
    // measurement, not on anticipation — says leave it. But the registry is
    // meant to grow towards 195 researched countries, and this is the one query
    // here whose cost scales with that rather than staying constant. Move the
    // comparison into SQL when the source count reaches the low thousands;
    // recorded now so it is a known bound rather than a surprise later.
    //
    // The bound that actually bites first is not memory, it is
    // PGRST_DB_MAX_ROWS=1000: past that an unbounded select silently returns a
    // prefix, and the stale count — a number that only matters when it is
    // rising — would stop rising. Paged so growth cannot quietly cap it.
    const staleRows = await pageRows<Record<string, unknown>>(
      () =>
        db
          .from('visa_sources')
          .select('id, last_success_at, freshness_sla')
          .eq('active', true) as never,
    );
    // REGOPS-002: this number has always been zero, and could not be anything
    // else.
    //
    // `visa_sources.freshness_sla` is a Postgres `interval` (see
    // 20260820120000_visa_registry_core.sql:257), which PostgREST serializes as
    // a string like '30 days'. `Number('30 days')` is NaN and `!NaN` is true,
    // so the old guard excluded EVERY source from the staleness check,
    // unconditionally. The one metric on this page that exists to go up has
    // never once been able to.
    //
    // The rest of the codebase already knew the shape: knowledge-freshness and
    // knowledge-retrieval both read this same column through
    // `parseIntervalMs(asText(...))`. Only this file used `Number`.
    //
    // The unit test hid it by mocking `freshness_sla: 30` — a plain number the
    // database never returns. It now uses the real '30 days' shape.
    const now = Date.now();
    const staleBeyondSla = (staleRows as any[]).filter((s) => {
      const slaMs = parseIntervalMs(asTextOrNull(s.freshness_sla));
      if (!slaMs) return false;
      if (!s.last_success_at) return true;
      return now - new Date(s.last_success_at).getTime() > slaMs;
    }).length;

    return {
      generatedAt: new Date().toISOString(),
      registry: {
        countriesTotal,
        countriesPublishable,
        countriesBaselineOnly: countriesTotal - countriesPublishable,
        visaTypesActive,
        requirementsActive,
        publishablePages,
      },
      provenance: {
        requirementsWithoutProvenance: withoutProvenance ?? 0,
        activeSourceVersions: activeVersions,
        versionsRetainingText: versionsWithText,
      },
      sources: {
        total: sourcesTotal,
        blocked: sourcesBlocked,
        staleBeyondSla,
      },
      lastRun: runRow
        ? {
            startedAt: (runRow as any).started_at ?? null,
            sourcesChecked: (runRow as any).sources_checked ?? 0,
            ok: (runRow as any).ok_count ?? 0,
            changed: (runRow as any).changed_count ?? 0,
            blocked: (runRow as any).blocked_count ?? 0,
            unavailable: (runRow as any).unavailable_count ?? 0,
            parseErrors: (runRow as any).parse_error_count ?? 0,
            clientRendered: (runRow as any).client_rendered_count ?? 0,
          }
        : null,
      reviews: {
        awaiting,
        unattributable: items.filter((i) => i.unattributable).length,
        items,
      },
    };
  }
}
