import { Inject, Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ANALYTICS_INGEST_QUEUE } from '../../shared/queue/queue.constants';
import {
  WAREHOUSE_PROVIDER,
  type IWarehouseProvider,
} from '../warehouse/warehouse.provider';
import type { AnalyticsEvent } from '../events/catalog';

@Injectable()
@Processor(ANALYTICS_INGEST_QUEUE)
export class AnalyticsIngestProcessor extends WorkerHost {
  private readonly log = new Logger(AnalyticsIngestProcessor.name);

  constructor(
    @Inject(WAREHOUSE_PROVIDER) private readonly provider: IWarehouseProvider,
  ) {
    super();
  }

  async process(job: Job<{ events: AnalyticsEvent[] }>): Promise<void> {
    const events = job.data?.events ?? [];
    if (events.length === 0) return;
    const { inserted } = await this.provider.writeEvents(events);
    if (inserted) this.log.debug(`analytics ingest — ${inserted} events`);
  }
}
