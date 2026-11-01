import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard, type AuthUser } from '../auth/jwt.guard';
import { RolesGuard, RequireRole } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { METRIC_REGISTRY } from '../analytics-metrics/metric.registry';
import type { MetricService } from '../analytics-metrics/contracts/metric.contract';
import {
  ANALYTICS_ALERTS_REPOSITORY,
  type IAnalyticsAlertsRepository,
} from './analytics-alerts.repository';
import { AlertEvaluatorService } from './alert-evaluator.service';
import { AnalyticsAlertsExceptionFilter } from './analytics-alerts.exception-filter';
import {
  AlertValidationError,
  AlertNotFoundError,
} from './analytics-alerts.errors';
import type { Condition } from './eval/condition.types';

@Controller('analytics/alerts')
@UseGuards(JwtGuard, RolesGuard)
@RequireRole('admin')
@UseFilters(AnalyticsAlertsExceptionFilter)
export class AlertsController {
  constructor(
    @Inject(ANALYTICS_ALERTS_REPOSITORY)
    private readonly repo: IAnalyticsAlertsRepository,
    private readonly evaluator: AlertEvaluatorService,
    @Inject(METRIC_REGISTRY)
    private readonly registry: Map<string, MetricService>,
  ) {}

  private validate(body: any) {
    if (!Array.isArray(body.conditions) || body.conditions.length === 0)
      throw new AlertValidationError('at least one condition required');
    if (!this.registry.has(body.metricKey))
      throw new AlertValidationError(`unknown metric '${body.metricKey}'`);
    const wantsDelta = (body.conditions as Condition[]).some(
      (c) => c.target.kind === 'delta_pct',
    );
    if (wantsDelta && !body.query?.compareTo)
      body.query = { ...body.query, compareTo: 'prev_period' };
  }

  @Post()
  async create(@Body() body: any, @CurrentUser() user: AuthUser) {
    this.validate(body);
    return this.repo.createRule({
      name: body.name,
      metricKey: body.metricKey,
      metric: body.metric,
      query: body.query,
      conditions: body.conditions,
      combine: body.combine ?? 'all',
      recipients: body.recipients ?? [],
      notifyUserIds: body.notifyUserIds ?? [],
      enabled: body.enabled ?? true,
      createdBy: user.id,
    });
  }
  @Get()
  list() {
    return this.repo.listRules();
  }
  @Get(':id')
  async get(@Param('id') id: string) {
    const r = await this.repo.getRule(id);
    if (!r) throw new AlertNotFoundError(id);
    return r;
  }
  @Patch(':id')
  async update(@Param('id') id: string, @Body() patch: any) {
    const r = await this.repo.updateRule(id, patch);
    if (!r) throw new AlertNotFoundError(id);
    return r;
  }
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.repo.deleteRule(id);
  }
  @Get(':id/events')
  events(@Param('id') id: string) {
    return this.repo.listEvents(id);
  }

  @Post(':id/test')
  async test(@Param('id') id: string) {
    const rule = await this.repo.getRule(id);
    if (!rule) throw new AlertNotFoundError(id);
    const { breached, actual } = await this.evaluator.evaluate(rule);
    const wouldFire = rule.state === 'ok' ? breached : !breached;
    return { breached, actual, wouldFire };
  }
}
