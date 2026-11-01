import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/configuration';
import { KPI_COHORT_QUEUE } from '../../shared/queue/queue.constants';

/**
 * Registers the repeatable cohort-recompute tick (heavier; daily by default).
 * Cadence from KPI_COHORT_INTERVAL_HOURS (default 24h).
 */
@Injectable()
export class KpiCohortScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(KPI_COHORT_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService<Env>,
  ) {}

  async onModuleInit(): Promise<void> {
    const everyHours =
      this.config.get('KPI_COHORT_INTERVAL_HOURS', { infer: true }) ?? 24;
    await this.queue.add(
      'recompute',
      {},
      {
        repeat: { every: everyHours * 3_600_000 },
        jobId: 'kpi-cohort-recompute',
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
  }
}
