import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { VISA_SOURCE_SYNC_QUEUE } from '../shared/queue/queue.constants';
import { scheduleFor, refreshHour } from '../forms/refresh-schedule';
import { withMinuteOffset } from '../doc-templates/doc-refresh.scheduler';

/**
 * The morning source check, scheduled per country.
 *
 * WHY IT REUSES forms/refresh-schedule.ts RATHER THAN ITS OWN CRON
 *
 * That module already solved the two problems this job has. Each country is
 * checked at 09:00 in ITS OWN timezone, so an applicant in Sydney sees a copy
 * confirmed against the Australian government's site that morning rather than
 * 20 hours earlier; and each country's minute is derived from a hash of its
 * code, so five governments are not hit in the same minute.
 *
 * THE OFFSET IS THE POINT OF THIS FILE
 *
 * Two jobs already fetch from these same hosts:
 *
 *   +0   form-refresh          blank application forms
 *   +30  doc-template-refresh  checklists, specs, guidance
 *   +60  visa-source-sync      THIS — the requirement pages themselves
 *
 * canada.ca serves all three for Canada. Without a third distinct offset this
 * job would land on the same host in the same minute as one of the others,
 * which is the exact shape that got VisaAI rate-limited by the European
 * Commission on 2026-08-13 (see doc-refresh.scheduler.ts). An hour of spacing
 * is cheap; a government blocking the egress IP is not, and it fails silently —
 * sources start returning 403 and the data quietly goes stale.
 */
export const SYNC_MINUTE_OFFSET = 60;

@Injectable()
export class VisaSyncScheduler implements OnModuleInit {
  private readonly log = new Logger(VisaSyncScheduler.name);

  constructor(
    @InjectQueue(VISA_SOURCE_SYNC_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    // Countries come from the REGISTRY, not the strategy list: visa_sources is
    // what this job reads, and a country can have monitored sources before it
    // has a runtime strategy. Scheduling from the strategies would silently
    // skip exactly the countries being onboarded.
    //
    // The processor resolves the country list at run time for the same reason —
    // a country added after boot must not wait for a restart to be checked.
    const schedule = scheduleFor('ALL', 'visa-source-sync');

    await this.queue.add(
      'visa-source-sync',
      {},
      {
        repeat: {
          pattern: withMinuteOffset(schedule.pattern, SYNC_MINUTE_OFFSET),
          tz: schedule.timezone,
        },
        jobId: schedule.jobId,
        removeOnComplete: true,
        removeOnFail: 20,
      },
    );

    this.log.log(
      `visa source sync scheduled daily at ~${String(refreshHour()).padStart(2, '0')}:xx ` +
        `(+${SYNC_MINUTE_OFFSET}m after the form/document refreshes)`,
    );
  }
}
