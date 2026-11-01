import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { RECONCILE_QUEUE } from '../shared/queue/queue.constants';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationProcessor } from './reconciliation.processor';
import { ReconciliationScheduler } from './reconciliation.scheduler';

/**
 * Daily payment reconciliation (SP1 / PRICE-12). SupabaseService +
 * PAYMENT_PROVIDER resolve from @Global scope; the job runs on the global
 * BullMQ connection (QueueModule).
 */
@Module({
  imports: [BullModule.registerQueue({ name: RECONCILE_QUEUE })],
  providers: [
    ReconciliationService,
    ReconciliationProcessor,
    ReconciliationScheduler,
  ],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
