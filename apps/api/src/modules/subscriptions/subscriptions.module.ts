import { Module, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/configuration';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionCreditsService } from './subscription-credits.service';
import { SUBSCRIPTIONS_REPOSITORY } from './subscriptions.repository';
import { SubscriptionsRepository } from './subscriptions.repository.impl';
import { PaymentWebhookService } from '../shared/payments/payment-webhook.service';
import {
  parsePriceCatalog,
  planFromPriceId,
  PLAN_CREDIT_CAP,
} from './subscription.constants';
import { AnalyticsEventBus } from '../analytics/analytics-event-bus';
import { makeServerEvent } from '../analytics/events/catalog';

@Module({
  controllers: [SubscriptionsController],
  providers: [
    SubscriptionsService,
    SubscriptionCreditsService,
    SubscriptionsRepository,
    { provide: SUBSCRIPTIONS_REPOSITORY, useExisting: SubscriptionsRepository },
  ],
  exports: [SubscriptionCreditsService],
})
export class SubscriptionsModule implements OnModuleInit {
  constructor(
    private readonly repo: SubscriptionsRepository,
    private readonly credits: SubscriptionCreditsService,
    private readonly webhook: PaymentWebhookService,
    private readonly config: ConfigService<Env>,
    @Optional() private readonly analytics?: AnalyticsEventBus,
  ) {}

  onModuleInit(): void {
    if (!this.config.get('SUBSCRIPTIONS_ENABLED', { infer: true })) return;
    const catalog = parsePriceCatalog(
      this.config.get('SUBSCRIPTION_PRICES', { infer: true }),
    );

    this.webhook.registerHandlers({
      onSubscriptionChanged: async (ev) => {
        const s = ev.raw as any;
        const priceId = s.items?.data?.[0]?.price?.id as string | undefined;
        const mapped =
          catalog && priceId ? planFromPriceId(catalog, priceId) : null;
        if (!mapped) return; // unknown price (flag/catalog mismatch) — skip

        // Read current state BEFORE the upsert so we can tell a brand-new
        // subscription (no prior row) from a status/plan update on an
        // existing one — needed to emit subscription.started exactly once,
        // at the real lifecycle transition, not on every renewal/update.
        const existing = await this.repo.getByStripeId(s.id);
        const userId =
          (s.metadata?.userId as string) ?? existing?.user_id ?? '';

        await this.repo.upsertFromStripe({
          userId,
          stripeSubscriptionId: s.id,
          stripeCustomerId: s.customer as string,
          plan: mapped.plan,
          status: s.status,
          billingInterval: mapped.interval,
          currentPeriodStart: s.current_period_start
            ? new Date(s.current_period_start * 1000)
            : null,
          currentPeriodEnd: s.current_period_end
            ? new Date(s.current_period_end * 1000)
            : null,
          cancelAtPeriodEnd: !!s.cancel_at_period_end,
        });

        if (s.status === 'canceled') {
          this.analytics?.emitSafe(
            makeServerEvent('subscription.canceled', {
              user_id: userId || null,
              props: { plan: mapped.plan, interval: mapped.interval },
            }),
          );
        } else if (
          !existing &&
          (s.status === 'active' || s.status === 'trialing')
        ) {
          this.analytics?.emitSafe(
            makeServerEvent('subscription.started', {
              user_id: userId || null,
              props: { plan: mapped.plan, interval: mapped.interval },
            }),
          );
        }
      },
      onInvoicePaid: async (ev) => {
        const sub = await this.repo.getByStripeId(ev.providerObjectId);
        if (!sub || !sub.current_period_start || !sub.current_period_end)
          return;
        if (PLAN_CREDIT_CAP[sub.plan] === 0) return; // base: nothing to grant
        await this.credits.grantForPeriod({
          subscriptionId: sub.id,
          userId: sub.user_id,
          plan: sub.plan,
          periodStart: new Date(sub.current_period_start),
          periodEnd: new Date(sub.current_period_end),
        });
      },
      onInvoicePaymentFailed: async (ev) => {
        const sub = await this.repo.getByStripeId(ev.providerObjectId);
        if (!sub) return;
        await this.repo.upsertFromStripe({
          userId: sub.user_id,
          stripeSubscriptionId: sub.stripe_subscription_id,
          stripeCustomerId: sub.stripe_customer_id,
          plan: sub.plan,
          status: 'past_due',
          billingInterval: sub.billing_interval,
          currentPeriodStart: sub.current_period_start
            ? new Date(sub.current_period_start)
            : null,
          currentPeriodEnd: sub.current_period_end
            ? new Date(sub.current_period_end)
            : null,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
        });
      },
    });
  }
}
