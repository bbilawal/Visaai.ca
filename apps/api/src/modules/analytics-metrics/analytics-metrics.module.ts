import { Module } from '@nestjs/common';
import { BillingAnalyticsModule } from '../billing-analytics/billing-analytics.module';
import { FinancialOpsModule } from '../financial-ops/financial-ops.module';
import { kpiSourceProvider } from './source/kpi-source.factory';
import { FinancialMetricsService } from './services/financial-metrics.service';
import { RetentionMetricsService } from './services/retention-metrics.service';
import { GrowthMetricsService } from './services/growth-metrics.service';
import { VisaMetricsService } from './services/visa-metrics.service';
import { ConsultantMetricsService } from './services/consultant-metrics.service';
import { AiMetricsService } from './services/ai-metrics.service';
import { JourneyMetricsService } from './services/journey-metrics.service';
import { RegistryMetricsService } from './services/registry-metrics.service';
import { METRIC_REGISTRY, buildMetricRegistry } from './metric.registry';
import {
  KpiRollupService,
  KPI_ROLLUP_WRITER,
} from './rollup/kpi-rollup.service';
import {
  KpiCohortService,
  KPI_COHORT_WRITER,
} from './rollup/kpi-cohort.service';
import { KpiRollupProcessor } from './rollup/kpi-rollup.processor';
import { KpiRollupScheduler } from './rollup/kpi-rollup.scheduler';
import { KpiCohortProcessor } from './rollup/kpi-cohort.processor';
import { KpiCohortScheduler } from './rollup/kpi-cohort.scheduler';
import { SupabaseKpiWriter } from './rollup/kpi-rollup.sources';
import {
  kpiRollupReaderProvider,
  kpiCohortReaderProvider,
} from './rollup/kpi-rollup-reader.factory';

const SERVICES = [
  FinancialMetricsService,
  RetentionMetricsService,
  GrowthMetricsService,
  VisaMetricsService,
  ConsultantMetricsService,
  AiMetricsService,
  JourneyMetricsService,
  RegistryMetricsService,
];

/**
 * SP-B KPI/metrics engine. Compute-only. Exposes eight injectable metric services
 * + a METRIC_REGISTRY to SP-C. Queues are registered globally in QueueModule.
 * Reader is a v1 stub (Noop); concrete source-wiring is a documented follow-up.
 */
@Module({
  imports: [BillingAnalyticsModule, FinancialOpsModule],
  providers: [
    kpiSourceProvider,
    ...SERVICES,
    KpiRollupService,
    KpiCohortService,
    KpiRollupProcessor,
    KpiRollupScheduler,
    KpiCohortProcessor,
    KpiCohortScheduler,
    SupabaseKpiWriter,
    kpiRollupReaderProvider,
    kpiCohortReaderProvider,
    { provide: KPI_ROLLUP_WRITER, useExisting: SupabaseKpiWriter },
    { provide: KPI_COHORT_WRITER, useExisting: SupabaseKpiWriter },
    {
      provide: METRIC_REGISTRY,
      inject: SERVICES,
      useFactory: (...s: FinancialMetricsService[]) => buildMetricRegistry(s),
    },
  ],
  exports: [...SERVICES, METRIC_REGISTRY],
})
export class AnalyticsMetricsModule {}
