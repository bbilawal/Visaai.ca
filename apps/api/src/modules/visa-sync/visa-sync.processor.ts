import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { VISA_SOURCE_SYNC_QUEUE } from '../shared/queue/queue.constants';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { VisaSyncService, type SyncSummary } from './visa-sync.service';

/**
 * Runs the morning source check.
 *
 * Uses the service-role client (`admin`) because this is a system path with no
 * user: it writes `visa_source_versions`, `visa_source_checks`,
 * `visa_sync_runs` and `visa_source_changes`, none of which grants INSERT to
 * any role. RLS denies by default there on purpose — see
 * 20260820150000_visa_registry_rls_fix.sql — so the sync is the only writer and
 * it must bypass RLS to be one.
 */
@Injectable()
@Processor(VISA_SOURCE_SYNC_QUEUE)
export class VisaSyncProcessor extends WorkerHost {
  private readonly log = new Logger(VisaSyncProcessor.name);

  constructor(private readonly supabase: SupabaseService) {
    super();
  }

  async process(job?: { data?: { limit?: number } }): Promise<SyncSummary> {
    const service = new VisaSyncService(this.supabase.admin);

    const summary = await service.run({
      trigger: 'schedule',
      limit: job?.data?.limit,
      // 2s between requests to the SAME host. Government sites are the whole
      // point of this job and the fastest way to lose access to them is to
      // look like a scraper.
      perHostDelayMs: 2_000,
    });

    this.log.log(
      `visa source sync ${summary.runId}: ${summary.sourcesChecked} checked, ` +
        `${summary.ok} ok, ${summary.changed} changed, ${summary.unavailable} unavailable, ` +
        `${summary.blocked} blocked, ${summary.parseErrors} parse errors ` +
        `(${Math.round(summary.durationMs / 1000)}s)`,
    );

    // A change that needs review is the reason this job exists. Log it at
    // warn so it surfaces without anyone querying the table — a material
    // government change sitting unnoticed for 48h means applicants may be
    // reading a rule that has moved.
    if (summary.changesRaisedForReview > 0) {
      this.log.warn(
        `${summary.changesRaisedForReview} source change(s) detected and queued. ` +
          `Material and structural changes require human review before they reach ` +
          `applicants; the previously reviewed version keeps serving until then.`,
      );
    }

    // Blocked sources are not errors to retry — an authority told us no, or
    // robots.txt did. Surfaced so the count does not silently drift upward.
    if (summary.blocked > 0) {
      this.log.warn(
        `${summary.blocked} source(s) blocked by robots.txt or an authority ` +
          `response. These are not retried; VisaAI serves the official link instead.`,
      );
    }

    if (summary.parseErrors > 0) {
      // Unlike `blocked`, this one IS ours to fix.
      this.log.error(
        `${summary.parseErrors} source(s) fetched but produced no usable text. ` +
          `That is an extractor bug, not an authority problem.`,
      );
    }

    return summary;
  }
}
