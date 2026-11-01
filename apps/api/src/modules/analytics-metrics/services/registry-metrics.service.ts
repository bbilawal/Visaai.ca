import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../shared/supabase/supabase.service';
import type {
  MetricFilters,
  MetricQuery,
  MetricResult,
  MetricService,
} from '../contracts/metric.contract';

/**
 * Health of the visa source registry, exposed as metrics so alert rules can
 * watch it.
 *
 * WHY THIS EXISTS
 *
 * The alert engine is real and has been ticking every five minutes in
 * production — with zero rules configured, because there was nothing for a rule
 * to watch. The metric registry offered consultant, ai, growth, financial,
 * retention, journey and visa, and `visa` is applicant funnels: approvals and
 * applications. Nothing described whether the SOURCE data underneath was sound.
 *
 * That is the half that actually fails, and it has failed repeatedly and
 * silently. A page whose government source went unreadable. A requirement whose
 * provenance went missing. Parse errors climbing on one host. Published pages
 * dropping because a migration half-applied. Every one of those is invisible
 * until somebody looks, and nobody looks at night.
 *
 * GAUGES, NOT TIME SERIES — AND SAID SO
 *
 * Four of these are current-state facts: how many published requirements lack
 * provenance RIGHT NOW. There is no history to bucket, so the series is a
 * single point at `to` and `meta.tier` is 'live'. Fabricating a flat line
 * across the requested range would make a number that has been broken all week
 * look like one that just broke, and vice versa.
 *
 * The run-derived metrics (parse errors, client-rendered) are genuine series:
 * `visa_sync_runs` records one row per run, so they bucket by day honestly.
 */

type RegistryMetric =
  | 'requirements_without_provenance'
  | 'publishable_pages'
  | 'changes_awaiting_review'
  | 'sources_blocked'
  | 'parse_errors'
  | 'client_rendered';

const GAUGES: RegistryMetric[] = [
  'requirements_without_provenance',
  'publishable_pages',
  'changes_awaiting_review',
  'sources_blocked',
];

@Injectable()
export class RegistryMetricsService implements MetricService {
  readonly key = 'registry';
  /** None. These are whole-registry facts; slicing them by plan or consultant is meaningless. */
  readonly supportedFilters: (keyof MetricFilters)[] = [];

  constructor(private readonly supabase: SupabaseService) {}

  async compute(
    query: MetricQuery & { metric?: RegistryMetric },
  ): Promise<MetricResult> {
    const metric = query.metric ?? 'requirements_without_provenance';
    return GAUGES.includes(metric)
      ? this.gauge(metric, query)
      : this.fromRuns(metric, query);
  }

  private result(
    metric: string,
    total: number,
    series: { bucket: string; value: number }[],
    tier: 'live' | 'rollup' | 'derived',
  ): MetricResult {
    return {
      metric,
      unit: 'count',
      total,
      series,
      meta: { computedAt: new Date().toISOString(), tier },
    };
  }

  private async gauge(
    metric: RegistryMetric,
    query: MetricQuery,
  ): Promise<MetricResult> {
    const db = this.supabase.admin;
    let count = 0;

    if (metric === 'requirements_without_provenance') {
      // The one number that must be zero. Every published requirement is
      // supposed to be bound to a verbatim excerpt from a specific source
      // version; one that is not is the product's central promise broken.
      const { count: n } = await db
        .from('visa_requirements')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active')
        .or('source_version_id.is.null,source_excerpt.is.null');
      count = n ?? 0;
    } else if (metric === 'publishable_pages') {
      const { count: n } = await db
        .from('visa_publishable_pages')
        .select('visaai_id', { count: 'exact', head: true });
      count = n ?? 0;
    } else if (metric === 'changes_awaiting_review') {
      const { count: n } = await db
        .from('visa_source_changes')
        .select('id', { count: 'exact', head: true })
        .eq('requires_review', true)
        .is('reviewed_at', null);
      count = n ?? 0;
    } else {
      const { count: n } = await db
        .from('visa_sources')
        .select('id', { count: 'exact', head: true })
        .gte('failure_streak', 3);
      count = n ?? 0;
    }

    // One point, at the end of the requested range. See the note above on why
    // this is not spread across the range.
    return this.result(
      metric,
      count,
      [{ bucket: query.to, value: count }],
      'live',
    );
  }

  private async fromRuns(
    metric: RegistryMetric,
    query: MetricQuery,
  ): Promise<MetricResult> {
    const column =
      metric === 'client_rendered'
        ? 'client_rendered_count'
        : 'parse_error_count';

    const { data } = await this.supabase.admin
      .from('visa_sync_runs')
      .select(`started_at, ${column}`)
      .gte('started_at', query.from)
      .lte('started_at', `${query.to}T23:59:59.999Z`)
      .order('started_at', { ascending: true });

    const rows = (data ?? []) as Record<string, unknown>[];

    const byDay = new Map<string, number>();
    for (const row of rows) {
      const day = String(row.started_at ?? '').slice(0, 10);
      if (!day) continue;
      // MAX per day for the SERIES. Several runs happen in a day and they
      // re-check the same sources, so summing would report six parse errors
      // where one source failed six times. A chart wants each day's worst
      // point.
      byDay.set(day, Math.max(byDay.get(day) ?? 0, Number(row[column] ?? 0)));
    }

    const series = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, value]) => ({ bucket, value }));

    /**
     * The TOTAL is the most recent RUN, not the most recent day.
     *
     * This was the day's max, and reality corrected it within minutes of the
     * rules going live: the parse-errors rule breached at 9 while the latest
     * run had 0. The 9 came from a run five hours earlier, before B-23's fix
     * was deployed. The fault was real, and it was already fixed, and the alert
     * said it was still happening.
     *
     * An alert on this asks "is it failing NOW". A day's maximum answers "did
     * it fail at any point today", which keeps firing for the rest of the day
     * after a fix lands — and an alert that stays red after you fix the thing
     * is one people learn to ignore. The series keeps the max so the history is
     * still visible.
     */
    const latest = rows.length ? Number(rows[rows.length - 1][column] ?? 0) : 0;
    return this.result(metric, latest, series, 'live');
  }
}
