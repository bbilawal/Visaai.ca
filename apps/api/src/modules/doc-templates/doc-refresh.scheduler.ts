import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DOC_TEMPLATE_REFRESH_QUEUE } from '../shared/queue/queue.constants';
import { strategyRegistry } from '../../strategies';
import { scheduleFor, refreshHour } from '../forms/refresh-schedule';

/**
 * Documents run this many minutes after the same country's forms.
 *
 * Canada serves both halves of its package from canada.ca, so without an offset
 * a country's two jobs would hit one government host in the same minute — the
 * shape that got us rate-limited by the European Commission on 2026-08-13.
 */
export const DOC_MINUTE_OFFSET = 30;

/**
 * Shift a `m h * * *` pattern by whole minutes, rolling the hour over.
 *
 * Rolling matters: a country whose staggered minute is 45 would otherwise be
 * written as minute 75, which cron rejects, and the schedule would silently
 * never fire.
 */
export function withMinuteOffset(pattern: string, offset: number): string {
  const [minute, hour, ...rest] = pattern.split(' ');
  const total = Number(minute) + offset;
  const newMinute = ((total % 60) + 60) % 60;
  const carry = Math.floor(total / 60);
  const newHour = (((Number(hour) + carry) % 24) + 24) % 24;
  return [newMinute, newHour, ...rest].join(' ');
}

@Injectable()
export class DocRefreshScheduler implements OnModuleInit {
  private readonly log = new Logger(DocRefreshScheduler.name);

  constructor(
    @InjectQueue(DOC_TEMPLATE_REFRESH_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    // One repeatable job per country at 09:00 local, mirroring the form job —
    // see forms/refresh-schedule.ts. The two run 30 minutes apart so a country
    // whose forms and documents come from the same host (canada.ca serves both
    // halves of the Canadian package) never gets both jobs in the same minute.
    await this.removeLegacyJob();

    for (const { code } of strategyRegistry.listCountries()) {
      const schedule = scheduleFor(code, 'doc-template-refresh');
      await this.queue.add(
        'country-document-refresh',
        { countryCode: schedule.countryCode },
        {
          repeat: {
            pattern: withMinuteOffset(schedule.pattern, DOC_MINUTE_OFFSET),
            tz: schedule.timezone,
          },
          jobId: schedule.jobId,
          removeOnComplete: true,
          removeOnFail: 20,
        },
      );
    }
    this.log.log(
      `document template refresh scheduled for ${strategyRegistry.listCountries().length} countries at ${String(refreshHour()).padStart(2, '0')}:xx local time`,
    );
  }

  /**
   * Remove the pre-2026-08-13 global schedule if it is still registered.
   *
   * MATCHED ON `name`, NOT `id`. `getRepeatableJobs()` returns the job NAME
   * (the first argument to queue.add) and leaves `id` null — MEASURED against
   * the live queue, where an earlier version of this method matched
   * `job.id === 'doc-template-refresh-daily'`, never fired, and left the global schedule running
   * alongside all 33 per-country ones. Tonight both would have hit every
   * government host.
   *
   * Best effort: a failure here must not stop the per-country jobs from being
   * scheduled, because THOSE are what keep the caches fresh. Worst case an
   * operator sees one extra run until the queue is cleaned.
   */
  private async removeLegacyJob(): Promise<void> {
    try {
      for (const job of await this.queue.getRepeatableJobs()) {
        if (job.name === 'daily-document-template-refresh') {
          await this.queue.removeRepeatableByKey(job.key);
          this.log.log(
            `removed the legacy global schedule (${job.pattern} UTC)`,
          );
        }
      }
    } catch (err) {
      this.log.warn(
        `could not inspect repeatable jobs: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
