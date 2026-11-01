import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard, RequireRole } from '../auth/roles.guard';
import { PayoutTaxService } from './payout-tax.service';
import { PayoutsService, type SweepSummary } from './payouts.service';

@Controller('admin/payouts')
@UseGuards(JwtGuard, RolesGuard)
@RequireRole('admin')
export class PayoutsAdminController {
  constructor(
    private readonly tax: PayoutTaxService,
    private readonly payouts: PayoutsService,
  ) {}

  @Post('tax-statements/:year')
  generate(@Param('year') year: string) {
    return this.tax.generateAllForYear(Number(year));
  }

  /**
   * Run the payout sweep now instead of waiting for the 04:00 UTC job.
   *
   * Operationally necessary: after a sweep fails (a currency mismatch, a
   * Connect account not yet payable) the fix would otherwise sit unverified for
   * a full day. Safe to call repeatedly — the sweep only picks up paid orders
   * with no payout_item, and each transfer carries a per-order idempotency key,
   * so a double-call returns Stripe's existing transfer rather than paying
   * twice.
   *
   * Runs inline rather than enqueuing so the caller gets the summary back and
   * can see failures immediately.
   */
  @Post('sweep')
  sweep(): Promise<SweepSummary> {
    return this.payouts.sweep();
  }
}
