import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/configuration';
import { KPI_ROLLUP_QUEUE } from '../../shared/queue/queue.constants';

/**
 * Registers the repeatable KPI-rollup tick. Fixed jobId so repeated boots do not
 * duplicate the schedule. Cadence from KPI_ROLLUP_INTERVAL_MIN (default 15m).
 */
@Injectable()
export class KpiRollupScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(KPI_ROLLUP_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService<Env>,
  ) {}

  async onModuleInit(): Promise<void> {
    const everyMin =
      this.config.get('KPI_ROLLUP_INTERVAL_MIN', { infer: true }) ?? 15;
    await this.queue.add(
      'recompute',
      {},
      {
        repeat: { every: everyMin * 60_000 },
        jobId: 'kpi-rollup-recompute',
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
  }
}
