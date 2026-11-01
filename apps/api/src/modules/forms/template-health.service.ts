import { Injectable, Logger, Optional } from '@nestjs/common';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { NotificationEventBus } from '../notifications/notification-event-bus';
import {
  assessFreshness,
  FRESHNESS_UNVERIFIED_DAYS,
  type FreshnessLevel,
} from './freshness';
import {
  platformAdminIds,
  resolveAdminEmails,
  type AdminDirectory,
} from '../admin/admin-recipients';

/**
 * How long a row may stay degraded before it is an ops problem rather than a
 * bad night. The refresh jobs run daily, so 48h means two consecutive failures
 * — past the point where a transient government outage explains it.
 */
export const DEGRADED_ALERT_HOURS = 48;

interface HealthRow {
  source: 'form' | 'document';
  country_code: string;
  code: string;
  status: string;
  last_checked_at: string | null;
  last_verified_at: string | null;
}

export interface TemplateHealthEntry {
  source: 'form' | 'document';
  countryCode: string;
  code: string;
  status: string;
  freshness: FreshnessLevel;
  ageDays: number | null;
  lastVerifiedAt: string | null;
  lastCheckedAt: string | null;
}

export interface TemplateHealthReport {
  checkedAt: string;
  total: number;
  ok: number;
  /** Degraded for longer than DEGRADED_ALERT_HOURS. */
  degraded: TemplateHealthEntry[];
  /** Not confirmed against the authority for FRESHNESS_UNVERIFIED_DAYS. */
  unverified: TemplateHealthEntry[];
  unreviewedRevisions: number;
  openSweepFindings: number;
  alerted: boolean;
}

/**
 * The watchdog over both caches.
 *
 * WHY THIS IS NOT AN analytics-alerts RULE
 *
 * That module evaluates KPI metric queries against thresholds over time
 * series. This is a point-in-time table scan of ~90 rows asking a structural
 * question ("is anything serving an unconfirmable government document?"), and
 * it must work even when the analytics pipeline is degraded — the two failures
 * are correlated, since both ride the same DB. So it reuses the pattern the
 * notification DLQ watchdog already established (`system.broadcast` to every
 * admin, deduped by a bucketed broadcastId), which is proven and cheap.
 *
 * Read with the admin client: these are not user-owned rows, and the caller is
 * a background job with no request context.
 */
@Injectable()
export class TemplateHealthService {
  private readonly log = new Logger(TemplateHealthService.name);

  constructor(
    private readonly supabase: SupabaseService,
    // Optional so the refresh jobs still run in a context where the global
    // notification bus is absent (tests, a trimmed boot). A watchdog that
    // cannot alert must still report — silence here would be worse than a
    // missing broadcast.
    @Optional() private readonly bus?: NotificationEventBus,
  ) {}

  async check(now: Date = new Date()): Promise<TemplateHealthReport> {
    const rows = await this.load();
    const degradedCutoff = new Date(
      now.getTime() - DEGRADED_ALERT_HOURS * 3_600_000,
    );

    const degraded: TemplateHealthEntry[] = [];
    const unverified: TemplateHealthEntry[] = [];
    let ok = 0;

    for (const row of rows) {
      const f = assessFreshness(
        { status: row.status, lastVerifiedAt: row.last_verified_at },
        now,
      );
      const entry: TemplateHealthEntry = {
        source: row.source,
        countryCode: row.country_code,
        code: row.code,
        status: row.status,
        freshness: f.level,
        ageDays: f.ageDays,
        lastVerifiedAt: row.last_verified_at,
        lastCheckedAt: row.last_checked_at,
      };

      // 'link_only' is a healthy terminal state by design — the authority
      // publishes a web page, or robots.txt disallows the file — so it is
      // neither ok-with-bytes nor a problem to page anyone about.
      if (row.status === 'link_only') continue;

      if (row.status === 'ok' && f.level !== 'unverified') {
        ok++;
        if (f.level === 'aging') {
          // Aging is informational: it means the nightly job has not confirmed
          // this row in a week, which is worth seeing in the report but is not
          // yet an alert.
          this.log.debug(
            `${row.country_code}/${row.code}: aging (${f.ageDays}d)`,
          );
        }
        continue;
      }

      if (f.level === 'unverified') unverified.push(entry);

      // Degraded means "has been failing long enough to be someone's problem".
      // A row that failed for the first time tonight is deliberately NOT here:
      // the cached copy is still being served and one bad night is normal.
      const checkedAt = row.last_checked_at
        ? Date.parse(row.last_checked_at)
        : null;
      const failingSinceBeforeCutoff =
        row.last_verified_at === null ||
        Date.parse(row.last_verified_at) < degradedCutoff.getTime();
      if (
        row.status !== 'ok' &&
        failingSinceBeforeCutoff &&
        // A row nothing has checked at all is a catalog entry the job never
        // reached — real, but reported through `unverified`, not as a
        // long-running failure.
        checkedAt !== null
      ) {
        degraded.push(entry);
      }
    }

    const [unreviewedRevisions, openSweepFindings] = await Promise.all([
      this.countUnreviewedRevisions(),
      this.countOpenFindings(),
    ]);

    const report: TemplateHealthReport = {
      checkedAt: now.toISOString(),
      total: rows.length,
      ok,
      degraded,
      unverified,
      unreviewedRevisions,
      openSweepFindings,
      alerted: false,
    };

    if (degraded.length > 0 || unverified.length > 0) {
      report.alerted = await this.alert(report, now);
    }
    return report;
  }

  private async load(): Promise<HealthRow[]> {
    const cols =
      'country_code, code:form_code, status, last_checked_at, last_verified_at';
    const [forms, documents] = await Promise.all([
      this.supabase.admin.from('form_templates').select(cols),
      this.supabase.admin
        .from('document_templates')
        .select(
          'country_code, code:template_code, status, last_checked_at, last_verified_at',
        ),
    ]);
    if (forms.error)
      throw new Error(`form_templates read failed: ${forms.error.message}`);
    if (documents.error)
      throw new Error(
        `document_templates read failed: ${documents.error.message}`,
      );

    return [
      ...((forms.data ?? []) as Omit<HealthRow, 'source'>[]).map((r) => ({
        ...r,
        source: 'form' as const,
      })),
      ...((documents.data ?? []) as Omit<HealthRow, 'source'>[]).map((r) => ({
        ...r,
        source: 'document' as const,
      })),
    ];
  }

  private async countUnreviewedRevisions(): Promise<number> {
    const { count, error } = await this.supabase.admin
      .from('template_revisions')
      .select('*', { count: 'exact', head: true })
      .is('reviewed_at', null);
    if (error) {
      this.log.warn(`revision count failed: ${error.message}`);
      return 0;
    }
    return count ?? 0;
  }

  private async countOpenFindings(): Promise<number> {
    const { count, error } = await this.supabase.admin
      .from('template_sweep_findings')
      .select('*', { count: 'exact', head: true })
      .in('status', ['new', 'acknowledged']);
    if (error) {
      this.log.warn(`sweep finding count failed: ${error.message}`);
      return 0;
    }
    return count ?? 0;
  }

  /**
   * Broadcast to every admin, deduped to one per day.
   *
   * The daily bucket matches the refresh cadence: the job runs nightly, so a
   * persistent failure would otherwise re-alert on every run forever. One line
   * a day per admin is a signal; one per run per row is noise people mute.
   */
  private async alert(
    report: TemplateHealthReport,
    now: Date,
  ): Promise<boolean> {
    if (!this.bus) {
      this.log.error(
        `template health degraded (${report.degraded.length} degraded, ` +
          `${report.unverified.length} unverified) — no notification bus available to alert`,
      );
      return false;
    }

    const sample = [...report.degraded, ...report.unverified]
      .slice(0, 5)
      .map((e) => `${e.countryCode}/${e.code} (${e.status})`)
      .join(', ');
    const body =
      `${report.degraded.length} cached government document(s) have been failing for over ` +
      `${DEGRADED_ALERT_HOURS}h and ${report.unverified.length} have not been confirmed in ` +
      `${FRESHNESS_UNVERIFIED_DAYS} days. Applicants are still served the last good copy, ` +
      `but it is no longer presented as current. ${sample ? `Affected: ${sample}.` : ''}`;

    const broadcastId = `template-health:${now.toISOString().slice(0, 10)}`; // yyyy-mm-dd
    let sent = 0;
    try {
      for await (const adminId of this.adminIds()) {
        this.bus.emit({
          type: 'system.broadcast',
          userId: adminId,
          broadcastId,
          data: {
            title: 'Government form cache needs attention',
            body,
            link: '/admin',
            category: 'system',
          },
        });
        sent++;
      }
    } catch (err) {
      // Never let alerting failure fail the refresh run that called us.
      this.log.error(
        `template health alert failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }

    this.log.warn(`template health alert emitted to ${sent} admin(s): ${body}`);
    return sent > 0;
  }

  /** Admin user ids — the same admins the login gate recognises (OPS-001). */
  private adminIds(): AsyncGenerator<string> {
    return platformAdminIds(
      this.supabase.admin as unknown as AdminDirectory,
      resolveAdminEmails(),
    );
  }
}
