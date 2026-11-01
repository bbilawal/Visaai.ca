import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ConnectService } from './connect.service';
import { PayoutsService } from './payouts.service';
import { z } from 'zod';
import { parseBody } from '../../common/zod-body';

/** API-002: tax identity. formType was already a union in TS but unenforced. */
const TaxProfileDto = z.object({
  taxCountry: z.string().length(2).toUpperCase(),
  formType: z.enum(['w9', 'w8']),
  taxId: z.string().max(64).optional(),
  businessName: z.string().max(200).optional(),
});

import { PayoutTaxService } from './payout-tax.service';

/**
 * Consultant-facing payout API (PAY-1, PAY-6). Authenticated; each route
 * resolves the caller's own consultant profile (a non-consultant is rejected).
 * No money amounts are accepted from the client — onboarding is Stripe-hosted
 * and earnings are read-only from the ledger.
 */
@Controller('payouts')
@UseGuards(JwtGuard)
export class PayoutsController {
  constructor(
    private readonly connect: ConnectService,
    private readonly payouts: PayoutsService,
    private readonly tax: PayoutTaxService,
  ) {}

  @Get('onboarding-link')
  onboardingLink(@CurrentUser() user: AuthUser) {
    return this.connect.onboardingLink(user.id);
  }

  @Get('status')
  status(@CurrentUser() user: AuthUser) {
    return this.payouts.status(user.id);
  }

  @Get('earnings')
  earnings(@CurrentUser() user: AuthUser) {
    return this.payouts.earnings(user.id);
  }

  @Get('history')
  history(@CurrentUser() user: AuthUser) {
    return this.payouts.history(user.id);
  }

  @Get('dashboard-link')
  dashboardLink(@CurrentUser() user: AuthUser) {
    return this.payouts.dashboardLink(user.id);
  }

  @Get('tax-profile')
  getTaxProfile(@CurrentUser() user: AuthUser) {
    return this.tax.getProfile(user.id);
  }

  @Post('tax-profile')
  upsertTaxProfile(@CurrentUser() user: AuthUser, @Body() rawBody: unknown) {
    return this.tax.upsertProfile(user.id, parseBody(TaxProfileDto, rawBody));
  }

  @Get('tax-statements')
  taxStatement(@CurrentUser() user: AuthUser, @Query('year') year: string) {
    return this.tax.generateStatement(user.id, Number(year));
  }
}
