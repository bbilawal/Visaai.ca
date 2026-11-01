/**
 * When the knowledge pipeline runs.
 *
 * THE OFFSET IS THE POINT OF THIS FILE, exactly as it is in
 * `visa-sync.scheduler.ts`. Four jobs now reach the same government hosts:
 *
 *   +0   form-refresh          blank application forms
 *   +30  doc-template-refresh  checklists, specs, guidance
 *   +60  visa-source-sync      the requirement pages themselves
 *   +90  knowledge-ingest      THIS — extraction and embedding
 *
 * canada.ca serves all four for Canada. Landing two of them on the same host
 * in the same minute is what got VisaAI rate-limited by the European
 * Commission on 2026-08-13, and it fails silently: sources start returning 403
 * and the corpus quietly goes stale while every dashboard stays green.
 *
 * The +90 slot is also where it BELONGS causally, not only where it is safe.
 * The sync at +60 is what creates the `visa_source_versions` rows this job
 * ingests; running earlier would ingest yesterday's worklist every day.
 *
 * In the steady state this job makes NO outbound requests at all — the sync
 * hands it the bytes it already fetched. The offset protects the backfill path,
 * which does fetch.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import { KNOWLEDGE_QUEUE } from '../shared/queue/queue.constants';
import { scheduleFor, refreshHour } from '../forms/refresh-schedule';
import { withMinuteOffset } from '../doc-templates/doc-refresh.scheduler';

export const KNOWLEDGE_MINUTE_OFFSET = 90;

/**
 * The sweep runs on its own schedule, four hours later.
 *
 * Separate from ingestion because it answers a different question and must not
 * be skewed by it: "which sources are stale" read immediately after a run that
 * just refreshed 200 of them reports a rosier corpus than the one users are
 * querying for the other 23 hours of the day.
 */
export const SWEEP_MINUTE_OFFSET = 90 + 4 * 60;

@Injectable()
export class KnowledgeScheduler implements OnModuleInit {
  private readonly log = new Logger(KnowledgeScheduler.name);

  constructor(@InjectQueue(KNOWLEDGE_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    const schedule = scheduleFor('ALL', 'knowledge-ingest');

    await this.queue.add(
      'knowledge-ingest',
      {},
      {
        repeat: {
          pattern: withMinuteOffset(schedule.pattern, KNOWLEDGE_MINUTE_OFFSET),
          tz: schedule.timezone,
        },
        jobId: schedule.jobId,
        removeOnComplete: true,
        removeOnFail: 20,
      },
    );

    const sweepSchedule = scheduleFor('ALL', 'knowledge-sweep');
    await this.queue.add(
      'knowledge-sweep',
      {},
      {
        repeat: {
          pattern: withMinuteOffset(sweepSchedule.pattern, SWEEP_MINUTE_OFFSET),
          tz: sweepSchedule.timezone,
        },
        jobId: sweepSchedule.jobId,
        removeOnComplete: true,
        removeOnFail: 20,
      },
    );

    this.log.log(
      `knowledge ingestion scheduled daily at ~${String(refreshHour()).padStart(2, '0')}:xx ` +
        `(+${KNOWLEDGE_MINUTE_OFFSET}m, after the source sync); sweep +${SWEEP_MINUTE_OFFSET}m`,
    );
  }
}
