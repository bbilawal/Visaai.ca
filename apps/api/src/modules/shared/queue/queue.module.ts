import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import {
  DOCUMENT_QUEUE,
  NOTIFICATION_QUEUE,
  REMINDER_QUEUE,
  ANALYTICS_INGEST_QUEUE,
  ANALYTICS_ROLLUP_QUEUE,
  ANALYTICS_RETENTION_QUEUE,
  KPI_ROLLUP_QUEUE,
  KPI_COHORT_QUEUE,
  ANALYTICS_REPORTS_QUEUE,
  ANALYTICS_ALERTS_QUEUE,
  FORM_REFRESH_QUEUE,
} from './queue.constants';
import type { Env } from '../../../config/configuration';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env>) => ({
        connection: {
          url: config.get('REDIS_URL', { infer: true })!,
        },
      }),
    }),
    BullModule.registerQueue({ name: DOCUMENT_QUEUE }),
    BullModule.registerQueue({ name: REMINDER_QUEUE }),
    BullModule.registerQueue({ name: NOTIFICATION_QUEUE }),
    BullModule.registerQueue({ name: ANALYTICS_INGEST_QUEUE }),
    BullModule.registerQueue({ name: ANALYTICS_ROLLUP_QUEUE }),
    BullModule.registerQueue({ name: ANALYTICS_RETENTION_QUEUE }),
    BullModule.registerQueue({ name: KPI_ROLLUP_QUEUE }),
    BullModule.registerQueue({ name: KPI_COHORT_QUEUE }),
    BullModule.registerQueue({ name: ANALYTICS_REPORTS_QUEUE }),
    BullModule.registerQueue({ name: ANALYTICS_ALERTS_QUEUE }),
    BullModule.registerQueue({ name: FORM_REFRESH_QUEUE }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
