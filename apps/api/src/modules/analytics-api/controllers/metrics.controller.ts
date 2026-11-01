import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  StreamableFile,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtGuard } from '../../auth/jwt.guard';
import { RolesGuard, RequireRole } from '../../auth/roles.guard';
import { MetricsQueryService } from '../query/metrics-query.service';
import { ExportService } from '../export/export.service';
import { AnalyticsApiExceptionFilter } from '../errors/analytics-api.exception-filter';
import type {
  MetricQuery,
  MetricFilters,
  Grain,
} from '../../analytics-metrics/contracts/metric.contract';

function parseQuery(q: Record<string, any>): MetricQuery & { metric?: string } {
  const filters = (q.filters ?? {}) as MetricFilters;
  return {
    from: q.from,
    to: q.to,
    grain: (q.grain ?? 'day') as Grain,
    metric: q.metric,
    compareTo: q.compareTo ?? null,
    filters: Object.keys(filters).length ? filters : undefined,
  };
}

@Controller('analytics')
@UseGuards(JwtGuard, RolesGuard)
@RequireRole('admin')
@UseFilters(AnalyticsApiExceptionFilter)
export class MetricsController {
  constructor(
    private readonly query: MetricsQueryService,
    private readonly exportService: ExportService,
  ) {}

  @Get('metrics/:key')
  getMetric(@Param('key') key: string, @Query() q: Record<string, any>) {
    return this.query.run(key, parseQuery(q), { fresh: q.fresh === '1' });
  }

  @Get('summary')
  summary(@Query() q: Record<string, any>) {
    return this.query.summary(parseQuery(q));
  }

  @Get('catalog')
  catalog() {
    return this.query.catalog();
  }

  @Get('metrics/:key/export')
  async exportMetric(
    @Param('key') key: string,
    @Query() q: Record<string, any>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const query = parseQuery(q);
    const result = await this.query.run(key, query, { fresh: true });
    const file = await this.exportService.render(q.format ?? 'csv', {
      key,
      metric: query.metric ?? key,
      query,
      result,
      title: key,
    });
    res.set({
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.filename}"`,
    });
    return new StreamableFile(file.buffer);
  }
}
