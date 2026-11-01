import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { VISA_SOURCE_SYNC_QUEUE } from '../shared/queue/queue.constants';
import { SupabaseModule } from '../shared/supabase/supabase.module';
import { VisaSyncProcessor } from './visa-sync.processor';
import { VisaSyncScheduler } from './visa-sync.scheduler';

/**
 * The daily official-source monitor.
 *
 * Deliberately thin: the work lives in pure, I/O-free modules
 * (source-fetcher, robots, normalize) plus one service that writes to the
 * database. This module only wires the queue, so the 71 tests that cover the
 * behaviour need no Nest context to run.
 *
 * No controller. There is no user-facing endpoint for the sync — it is a
 * scheduled system job, and a manual trigger belongs behind the admin surface
 * rather than in this module.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: VISA_SOURCE_SYNC_QUEUE }),
    SupabaseModule,
  ],
  providers: [VisaSyncProcessor, VisaSyncScheduler],
})
export class VisaSyncModule {}
