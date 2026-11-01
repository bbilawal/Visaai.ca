import { Inject, Injectable, Logger } from '@nestjs/common';
import { ExportService } from '../export/export.service';
import {
  REPORT_MAILER,
  REPORT_NOTIFIER,
  type ReportMailer,
  type ReportNotifier,
} from './report-delivery.ports';
import type {
  SavedReportRow,
  ScheduledReportRow,
} from './analytics-reports.repository';
import type { MetricResult } from '../../analytics-metrics/contracts/metric.contract';

@Injectable()
export class ReportDeliveryService {
  private readonly log = new Logger(ReportDeliveryService.name);
  constructor(
    private readonly exportService: ExportService,
    @Inject(REPORT_MAILER) private readonly mailer: ReportMailer,
    @Inject(REPORT_NOTIFIER) private readonly notifier: ReportNotifier,
  ) {}

  async deliver(input: {
    saved: SavedReportRow;
    schedule: ScheduledReportRow;
    result: MetricResult;
    runId: string;
  }): Promise<{ delivered: boolean; error?: string }> {
    const { saved, schedule, result, runId } = input;
    try {
      const file = await this.exportService.render(schedule.format, {
        key: saved.metricKey,
        metric: saved.metric,
        query: { from: '', to: '', grain: saved.query.grain },
        result,
        title: saved.name,
      });
      const subject = `Report: ${saved.name}`;
      const html = `<p><strong>${saved.name}</strong>: ${result.total} ${result.unit}${result.meta.stale ? ' (stale)' : ''}</p>`;
      await this.mailer.mail({
        recipients: schedule.recipients,
        subject,
        html,
        file: {
          filename: file.filename,
          content: file.buffer,
          contentType: file.contentType,
        },
      });
      await this.notifier.notify({
        userIds: schedule.notifyUserIds,
        title: `Report ready: ${saved.name}`,
        body: `${result.total} ${result.unit}`,
        link: `/analytics/reports/${saved.id}/runs/${runId}`,
      });
      return { delivered: true };
    } catch (e) {
      this.log.warn(
        `delivery failed for report ${saved.id}: ${(e as Error).message}`,
      );
      return { delivered: false, error: (e as Error).message };
    }
  }
}
