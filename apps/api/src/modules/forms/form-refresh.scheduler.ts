import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { FORM_REFRESH_QUEUE } from '../shared/queue/queue.constants';
import { strategyRegistry } from '../../strategies';
import { scheduleFor, refreshHour } from './refresh-schedule';

@Injectable()
export class FormRefreshScheduler implements OnModuleInit {
  private readonly log = new Logger(FormRefreshScheduler.name);

  constructor(@InjectQueue(FORM_REFRESH_QUEUE) private readonly queue: Queue) {}

  async onModuleInit() {
    // One repeatable job PER COUNTRY, at 09:00 in that country's own timezone.
    // A single nightly UTC pass meant an applicant in Sydney could open the app
    // at 08:00 local and see a cache last confirmed 20 hours earlier; checking
    // in each government's own morning is the freshest point at which a
    // revision published overnight has actually landed. See refresh-schedule.ts
    // for the timezone table and why the minute is staggered per country.
    //
    // The legacy single 02:00 UTC job is removed here so a box that has run the
    // old build does not keep both schedules. BullMQ keys a repeatable job by
    // its pattern+jobId, so leaving it would double the load on every portal.
    await this.removeLegacyJob();

    for (const { code } of strategyRegistry.listCountries()) {
      const schedule = scheduleFor(code, 'form-refresh');
      await this.queue.add(
        'country-form-refresh',
        { countryCode: schedule.countryCode },
        {
          repeat: { pattern: schedule.pattern, tz: schedule.timezone },
          jobId: schedule.jobId,
          removeOnComplete: true,
          removeOnFail: 20,
        },
      );
    }
    this.log.log(
      `form refresh scheduled for ${strategyRegistry.listCountries().length} countries at ${String(refreshHour()).padStart(2, '0')}:xx local time`,
    );
  }

  /**
   * Remove the pre-2026-08-13 global schedule if it is still registered.
   *
   * MATCHED ON `name`, NOT `id`. `getRepeatableJobs()` returns the job NAME
   * (the first argument to queue.add) and leaves `id` null — MEASURED against
   * the live queue, where an earlier version of this method matched
   * `job.id === 'form-refresh-daily'`, never fired, and left the global schedule running
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
        if (job.name === 'daily-form-refresh') {
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
