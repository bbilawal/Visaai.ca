import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard, RequireRole } from '../auth/roles.guard';
import { BillingAnalyticsService } from './billing-analytics.service';
import type { ReportDimension } from '../financial-ops/financial-ops.repository';

@Controller('admin')
@UseGuards(JwtGuard, RolesGuard)
@RequireRole('admin')
export class BillingAnalyticsController {
  constructor(private readonly analytics: BillingAnalyticsService) {}

  @Get('analytics/subscriptions')
  subscriptions() {
    return this.analytics.subscriptionMetrics();
  }

  @Get('analytics/outstanding')
  outstanding() {
    return this.analytics.outstanding();
  }

  @Get('refunds')
  refunds() {
    return this.analytics.listRefunds();
  }

  @Get('reports/revenue.csv')
  @Header('Content-Type', 'text/csv')
  revenueCsv(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('by') by?: ReportDimension,
  ): Promise<string> {
    if (!from || !to) throw new BadRequestException('from and to are required');
    return this.analytics.revenueCsv(from, to, by);
  }
}
