import { Injectable } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/configuration';
import { KPI_ROLLUP_QUEUE } from '../../shared/queue/queue.constants';
import { KpiRollupService } from './kpi-rollup.service';

/** Runs the KPI rollup recompute on each repeatable tick (see KpiRollupScheduler). */
@Injectable()
@Processor(KPI_ROLLUP_QUEUE)
export class KpiRollupProcessor extends WorkerHost {
  constructor(
    private readonly rollup: KpiRollupService,
    private readonly config: ConfigService<Env>,
  ) {
    super();
  }

  async process(): Promise<void> {
    const lookback =
      this.config.get('KPI_ROLLUP_LOOKBACK_DAYS', { infer: true }) ?? 3;
    await this.rollup.recompute(lookback);
  }
}
