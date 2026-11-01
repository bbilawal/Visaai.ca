import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { JwtGuard } from '../auth/jwt.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { RolesGuard, RequireRole } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { parseBody } from '../../common/zod-body';
import { BillingService } from './billing.service';

const WaivePrefillDto = z.object({
  reason: z.string().trim().min(3).max(500),
});

/** Admin-only billing actions. Every one is audited by the service. */
@Controller('admin/applications')
@UseGuards(JwtGuard, RolesGuard)
@RequireRole('admin')
export class BillingAdminController {
  constructor(private readonly billing: BillingService) {}

  /** Comp the one-time form fee: unlock portal auto-fill without a charge. */
  @Post(':id/prefill-waiver')
  waivePrefill(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    const { reason } = parseBody(WaivePrefillDto, body);
    return this.billing.waivePrefillFee(id, user.id, reason);
  }
}
