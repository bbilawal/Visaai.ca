import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  WAREHOUSE_PROVIDER,
  type IWarehouseProvider,
} from '../warehouse/warehouse.provider';
import type { Env } from '../../../config/configuration';

@Injectable()
export class AnalyticsRetentionService {
  private readonly log = new Logger(AnalyticsRetentionService.name);

  constructor(
    @Inject(WAREHOUSE_PROVIDER) private readonly wh: IWarehouseProvider,
    private readonly config: ConfigService<Env>,
  ) {}

  async prune(): Promise<{ droppedPartitions: number }> {
    const days =
      this.config.get('ANALYTICS_RAW_RETENTION_DAYS', { infer: true }) ?? 90;
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const res = await this.wh.pruneBefore(cutoff);
    this.log.log(`analytics retention — pruned before ${cutoff}`);
    return res;
  }
}
