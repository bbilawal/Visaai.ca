import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { Env } from '../../../config/configuration';
import { ANALYTICS_REPORTS_QUEUE } from '../../shared/queue/queue.constants';

/**
 * Registers the repeatable dispatcher tick. Fixed jobId so repeated boots do not
 * duplicate the schedule. Cadence from ANALYTICS_REPORTS_TICK_MIN (default 5m).
 */
@Injectable()
export class ReportScheduleScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(ANALYTICS_REPORTS_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService<Env>,
  ) {}

  async onModuleInit(): Promise<void> {
    const everyMin =
      this.config.get('ANALYTICS_REPORTS_TICK_MIN', { infer: true }) ?? 5;
    await this.queue.add(
      'tick',
      {},
      {
        repeat: { every: everyMin * 60_000 },
        jobId: 'analytics-reports-tick',
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
  }
}
