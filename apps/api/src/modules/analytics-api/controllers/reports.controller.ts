import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtGuard, type AuthUser } from '../../auth/jwt.guard';
import { RolesGuard, RequireRole } from '../../auth/roles.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AnalyticsApiExceptionFilter } from '../errors/analytics-api.exception-filter';
import { SavedReportsService } from '../reports/saved-reports.service';
import { ExportService } from '../export/export.service';
import {
  ANALYTICS_REPORTS_REPOSITORY,
  type IAnalyticsReportsRepository,
} from '../reports/analytics-reports.repository';
import { nextRunAt } from '../reports/cron.util';
import { z } from 'zod';
import { parseBody } from '../../../common/zod-body';

/**
 * API-002: these two handlers took `body: any` and spread it straight into the
 * service, so `name`/`metricKey`/`metric` could be any type or absent entirely.
 * `query` stays permissive (it is `any` on SavedReportRow — a metric query
 * object validated downstream), but it must at least be an object.
 */
const CreateReportDto = z.object({
  name: z.string().min(1).max(200),
  metricKey: z.string().min(1).max(200),
  metric: z.string().min(1).max(200),
  query: z.record(z.string(), z.unknown()),
});
const UpdateReportDto = CreateReportDto.partial();
const ScheduleDto = z.object({
  cron: z.string().min(1).max(200),
  format: z.enum(['pdf', 'xlsx']),
  recipients: z.array(z.string().email()),
  notifyUserIds: z.array(z.string().uuid()).optional(),
});

@Controller('analytics/reports')
@UseGuards(JwtGuard, RolesGuard)
@RequireRole('admin')
@UseFilters(AnalyticsApiExceptionFilter)
export class ReportsController {
  constructor(
    private readonly saved: SavedReportsService,
    private readonly exportService: ExportService,
    @Inject(ANALYTICS_REPORTS_REPOSITORY)
    private readonly repo: IAnalyticsReportsRepository,
  ) {}

  @Post()
  create(@Body() rawBody: unknown, @CurrentUser() user: AuthUser) {
    const body = parseBody(CreateReportDto, rawBody);
    return this.saved.create({
      name: body.name,
      metricKey: body.metricKey,
      metric: body.metric,
      query: body.query,
      createdBy: user.id,
    });
  }
  @Get()
  list() {
    return this.saved.list();
  }
  @Get(':id')
  get(@Param('id') id: string) {
    return this.saved.get(id);
  }
  @Patch(':id')
  update(@Param('id') id: string, @Body() rawPatch: unknown) {
    return this.saved.update(id, parseBody(UpdateReportDto, rawPatch));
  }
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.saved.delete(id);
  }
  @Post(':id/run')
  run(@Param('id') id: string) {
    return this.saved.run(id, new Date());
  }
  @Get(':id/runs')
  runs(@Param('id') id: string) {
    return this.repo.listRuns(id);
  }

  @Post(':id/schedule')
  async schedule(@Param('id') id: string, @Body() rawBody: unknown) {
    const body = parseBody(ScheduleDto, rawBody);
    await this.saved.get(id); // 404 if missing
    return this.repo.upsertSchedule({
      savedReportId: id,
      cron: body.cron,
      format: body.format,
      recipients: body.recipients,
      notifyUserIds: body.notifyUserIds ?? [],
      nextRunAt: nextRunAt(body.cron, new Date()),
      enabled: true,
    });
  }

  @Delete(':id/schedule')
  async unschedule(@Param('id') id: string) {
    await this.repo.deleteScheduleForReport(id);
    return { ok: true };
  }

  @Get(':id/export')
  async export(
    @Param('id') id: string,
    @Query('format') format: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { result, saved } = await this.saved.run(id, new Date());
    const file = await this.exportService.render(format ?? 'pdf', {
      key: saved.metricKey,
      metric: saved.metric,
      query: { from: '', to: '', grain: saved.query.grain },
      result,
      title: saved.name,
    });
    res.set({
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.filename}"`,
    });
    return new StreamableFile(file.buffer);
  }
}
