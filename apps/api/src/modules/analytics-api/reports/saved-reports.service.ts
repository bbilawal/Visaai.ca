import { Inject, Injectable } from '@nestjs/common';
import {
  ANALYTICS_REPORTS_REPOSITORY,
  type IAnalyticsReportsRepository,
  type SavedReportRow,
} from './analytics-reports.repository';
import { MetricsQueryService } from '../query/metrics-query.service';
import { resolveRange } from '../query/range.resolver';
import { ReportNotFoundError } from '../errors/analytics-api.errors';
import type {
  MetricResult,
  MetricQuery,
} from '../../analytics-metrics/contracts/metric.contract';

@Injectable()
export class SavedReportsService {
  constructor(
    @Inject(ANALYTICS_REPORTS_REPOSITORY)
    private readonly repo: IAnalyticsReportsRepository,
    private readonly query: MetricsQueryService,
  ) {}

  create(input: Omit<SavedReportRow, 'id' | 'createdAt' | 'updatedAt'>) {
    return this.repo.createSaved(input);
  }
  list() {
    return this.repo.listSaved();
  }
  async get(id: string) {
    const r = await this.repo.getSaved(id);
    if (!r) throw new ReportNotFoundError(id);
    return r;
  }
  async update(
    id: string,
    patch: Partial<
      Pick<SavedReportRow, 'name' | 'metricKey' | 'metric' | 'query'>
    >,
  ) {
    const r = await this.repo.updateSaved(id, patch);
    if (!r) throw new ReportNotFoundError(id);
    return r;
  }
  delete(id: string) {
    return this.repo.deleteSaved(id);
  }

  async run(
    id: string,
    now: Date,
    scheduledReportId: string | null = null,
  ): Promise<{ result: MetricResult; runId: string; saved: SavedReportRow }> {
    const saved = await this.get(id);
    const { from, to } = resolveRange(saved.query, now);
    const query: MetricQuery & { metric?: string } = {
      from,
      to,
      grain: saved.query.grain,
      filters: saved.query.filters,
      metric: saved.metric,
    };
    try {
      const result = await this.query.run(saved.metricKey, query, {
        fresh: true,
      });
      const run = await this.repo.insertRun({
        savedReportId: id,
        scheduledReportId,
        status: 'success',
        resultSnapshot: result,
        error: null,
        deliveryError: null,
      });
      return { result, runId: run.id, saved };
    } catch (e) {
      await this.repo.insertRun({
        savedReportId: id,
        scheduledReportId,
        status: 'failed',
        resultSnapshot: null,
        error: (e as Error).message,
        deliveryError: null,
      });
      throw e;
    }
  }
}
