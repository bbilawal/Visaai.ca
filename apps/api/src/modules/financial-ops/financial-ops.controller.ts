import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard, RequireRole } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/jwt.guard';
import { RefundService } from './refund.service';
import { DisputeService } from './dispute.service';
import { FinancialReportService } from './financial-report.service';
import { z } from 'zod';
import { parseBody } from '../../common/zod-body';

/** API-002: a refund amount is money — it must be a positive integer of cents. */
const RefundDto = z.object({
  amountCents: z.number().int().positive().optional(),
  reason: z.string().max(500).optional(),
});

import type { ReportDimension } from './financial-ops.repository';

@Controller('admin')
@UseGuards(JwtGuard, RolesGuard)
@RequireRole('admin')
export class FinancialOpsController {
  constructor(
    private readonly refunds: RefundService,
    private readonly disputes: DisputeService,
    private readonly reports: FinancialReportService,
  ) {}

  @Post('payments/:id/refund')
  refund(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() rawBody: unknown,
  ) {
    const body = parseBody(RefundDto, rawBody);
    return this.refunds.initiateRefund(
      id,
      user.id,
      body.amountCents,
      body.reason,
    );
  }

  @Get('disputes')
  listDisputes() {
    return this.disputes.listDisputes();
  }

  @Get('reports/revenue')
  revenue(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('by') by?: ReportDimension,
  ) {
    if (!from || !to) throw new BadRequestException('from and to are required');
    return this.reports.report(from, to, by);
  }
}
