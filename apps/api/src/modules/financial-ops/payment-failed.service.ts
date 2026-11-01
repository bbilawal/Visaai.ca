import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PaymentWebhookEvent } from '../shared/payments/payment-provider.port';
import {
  FINANCIAL_OPS_REPOSITORY,
  type IFinancialOpsRepository,
} from './financial-ops.repository';
import { AnalyticsEventBus } from '../analytics/analytics-event-bus';
import { makeServerEvent } from '../analytics/events/catalog';

@Injectable()
export class PaymentFailedService {
  constructor(
    @Inject(FINANCIAL_OPS_REPOSITORY)
    private readonly repo: IFinancialOpsRepository,
    @Optional() private readonly analytics?: AnalyticsEventBus,
  ) {}

  /** Webhook: a one-time PaymentIntent failed. Mark any pending row failed
   *  (no-op if none). Recovery is the user re-initiating checkout.
   *
   *  NOTE: hosted Checkout Sessions (mode:'payment') do not currently forward
   *  our userId/applicationId metadata onto the underlying PaymentIntent (no
   *  `payment_intent_data.metadata` is set at session creation), so
   *  `ev.metadata` is typically empty for this event today. user_id/
   *  application_id will be null in that common case — documented gap, not
   *  fabricated data. */
  async onPaymentFailed(
    ev: Extract<PaymentWebhookEvent, { type: 'payment.failed' }>,
  ): Promise<void> {
    await this.repo.markPaymentFailed(ev.providerObjectId);
    this.analytics?.emitSafe(
      makeServerEvent('payment.failed', {
        user_id: ev.metadata.userId ?? null,
        application_id: ev.metadata.applicationId ?? null,
        props: {
          amount_cents: ev.amount?.amountMinor ?? null,
          currency: ev.amount?.currency ?? null,
          kind: 'one_time',
        },
      }),
    );
  }
}
