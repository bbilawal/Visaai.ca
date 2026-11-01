import { Module } from '@nestjs/common';
import { AnalyticsMetricsModule } from '../analytics-metrics/analytics-metrics.module';
import { EmailModule } from '../shared/email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  cacheClientProvider,
  metricsCacheProvider,
} from './query/cache.factory';
import { MetricsQueryService } from './query/metrics-query.service';
import { CsvExporter } from './export/csv.exporter';
import { XlsxExporter } from './export/xlsx.exporter';
import { PdfExporter } from './export/pdf.exporter';
import { ExportService } from './export/export.service';
import { MetricsController } from './controllers/metrics.controller';
import { ReportsController } from './controllers/reports.controller';
import { ANALYTICS_REPORTS_REPOSITORY } from './reports/analytics-reports.repository';
import { SupabaseAnalyticsReportsRepository } from './reports/analytics-reports.repository.impl';
import { SavedReportsService } from './reports/saved-reports.service';
import { ReportDeliveryService } from './reports/report-delivery.service';
import { EmailReportMailer } from './reports/report-mailer.impl';
import { SpineReportNotifier } from './reports/report-notifier.impl';
import {
  REPORT_MAILER,
  REPORT_NOTIFIER,
} from './reports/report-delivery.ports';
import { ReportRunProcessor } from './reports/report-run.processor';
import { ReportScheduleScheduler } from './reports/report-schedule.scheduler';

@Module({
  imports: [AnalyticsMetricsModule, EmailModule, NotificationsModule],
  controllers: [MetricsController, ReportsController],
  providers: [
    cacheClientProvider,
    metricsCacheProvider,
    MetricsQueryService,
    CsvExporter,
    XlsxExporter,
    PdfExporter,
    ExportService,
    {
      provide: ANALYTICS_REPORTS_REPOSITORY,
      useClass: SupabaseAnalyticsReportsRepository,
    },
    SavedReportsService,
    ReportDeliveryService,
    EmailReportMailer,
    SpineReportNotifier,
    { provide: REPORT_MAILER, useExisting: EmailReportMailer },
    { provide: REPORT_NOTIFIER, useExisting: SpineReportNotifier },
    ReportRunProcessor,
    ReportScheduleScheduler,
  ],
  exports: [MetricsQueryService], // consumed by analytics-alerts (SP-E) evaluator
})
export class AnalyticsApiModule {}
