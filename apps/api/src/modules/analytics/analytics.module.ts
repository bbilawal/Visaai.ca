import { Global, Module } from '@nestjs/common';
import { AnalyticsEventBus } from './analytics-event-bus';
import { warehouseProvider } from './warehouse/warehouse.factory';
import { AnalyticsIngestService } from './ingest/analytics-ingest.service';
import { AnalyticsIngestProcessor } from './ingest/analytics-ingest.processor';
import { AnalyticsRollupService } from './rollup/analytics-rollup.service';
import { AnalyticsRollupScheduler } from './rollup/analytics-rollup.scheduler';
import { AnalyticsRollupProcessor } from './rollup/analytics-rollup.processor';
import { AnalyticsRetentionService } from './retention/analytics-retention.service';
import { AnalyticsRetentionScheduler } from './retention/analytics-retention.scheduler';
import { AnalyticsRetentionProcessor } from './retention/analytics-retention.processor';
import { AnalyticsController } from './analytics.controller';
import { AuditAnalyticsAdapter } from './adapters/audit-analytics.adapter';
import { AnalyticsAiTelemetryAdapter } from './adapters/ai-telemetry.adapter';
import { AI_TELEMETRY } from '../shared/ai/ai-telemetry.port';

/**
 * AnalyticsModule — assembles Tasks 3-10 (event bus, warehouse provider,
 * ingest, rollup, retention) into the app. @Global so any producer can
 * inject AnalyticsEventBus without importing this module (mirrors
 * NotificationBusModule / EventBusModule).
 *
 * Deliberately does NOT call `BullModule.registerQueue(...)` for
 * ANALYTICS_INGEST_QUEUE / ANALYTICS_ROLLUP_QUEUE / ANALYTICS_RETENTION_QUEUE:
 * those are already registered by the @Global QueueModule
 * (shared/queue/queue.module.ts), which exports BullModule app-wide.
 * Re-registering them here would create duplicate/competing queue providers.
 * The @InjectQueue(...) calls in the ingest service and the rollup/retention
 * schedulers resolve from that global registration.
 *
 * SupabaseModule and AuthModule (JwtGuard, used by AnalyticsController) are
 * also @Global and are not re-imported here, mirroring the established
 * pattern in MarketplaceModule/MessagingModule/MatchingModule/CommissionModule.
 */
@Global()
@Module({
  controllers: [AnalyticsController],
  providers: [
    AnalyticsEventBus,
    warehouseProvider,
    AnalyticsIngestService,
    AnalyticsIngestProcessor,
    AnalyticsRollupService,
    AnalyticsRollupScheduler,
    AnalyticsRollupProcessor,
    AnalyticsRetentionService,
    AnalyticsRetentionScheduler,
    AnalyticsRetentionProcessor,
    AuditAnalyticsAdapter,
    AnalyticsAiTelemetryAdapter,
    // ARCH-003: satisfy shared/ai's AiTelemetrySink port from this side, so
    // `shared` no longer imports `analytics`. @Global means AiService resolves
    // it without importing AnalyticsModule.
    { provide: AI_TELEMETRY, useExisting: AnalyticsAiTelemetryAdapter },
  ],
  exports: [AnalyticsEventBus, AuditAnalyticsAdapter, AI_TELEMETRY],
})
export class AnalyticsModule {}
