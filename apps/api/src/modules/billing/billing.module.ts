import { Module, OnModuleInit } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingAdminController } from './billing.admin.controller';
import { BillingService } from './billing.service';
import { PricingModule } from '../pricing/pricing.module';
import { CommissionModule } from '../commission/commission.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { ConnectService } from '../payouts/connect.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { DiscountsModule } from '../discounts/discounts.module';
import { PaymentWebhookService } from '../shared/payments/payment-webhook.service';
import type { StripeAccountLike } from '../payouts/payouts.engine';

@Module({
  imports: [
    PricingModule, // PricingService = the server-side price authority + floor gate
    CommissionModule, // CommissionService.splitFor for service-order checkout (PAY-3)
    PayoutsModule, // ConnectService for the account.updated webhook (PAY-2)
    SubscriptionsModule, // SubscriptionCreditsService for premium_review credit consumption
    DiscountsModule, // DiscountService for coupon-aware one-time checkouts
  ],
  controllers: [BillingController, BillingAdminController],
  providers: [BillingService],
})
export class BillingModule implements OnModuleInit {
  constructor(
    private readonly billing: BillingService,
    private readonly connect: ConnectService,
    private readonly paymentWebhook: PaymentWebhookService,
  ) {}

  // Register domain side-effect handlers on the provider-agnostic webhook
  // dispatcher. The shared PaymentWebhookService owns verify + ledger
  // idempotency; billing/connect own what the events mean.
  onModuleInit(): void {
    this.paymentWebhook.registerHandlers({
      onCheckoutCompleted: (ev) => this.billing.recordCheckoutCompleted(ev),
      onConnectAccountUpdated: (ev) =>
        this.connect.syncAccountStatus(ev.raw as StripeAccountLike),
    });
  }
}
