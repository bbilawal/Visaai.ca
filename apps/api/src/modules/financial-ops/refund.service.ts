import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type PaymentWebhookEvent,
} from '../shared/payments/payment-provider.port';
import {
  FINANCIAL_OPS_REPOSITORY,
  type IFinancialOpsRepository,
} from './financial-ops.repository';

@Injectable()
export class RefundService {
  private readonly log = new Logger(RefundService.name);

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(FINANCIAL_OPS_REPOSITORY)
    private readonly repo: IFinancialOpsRepository,
  ) {}

  async initiateRefund(
    paymentId: string,
    adminId: string,
    amountCents?: number,
    reason?: string,
  ): Promise<{ id: string }> {
    const payment = await this.repo.getPayment(paymentId);
    if (!payment) throw new BadRequestException('Payment not found');
    if (payment.status !== 'complete') {
      throw new BadRequestException(
        `Cannot refund a ${payment.status} payment`,
      );
    }
    if (!payment.stripe_payment_intent_id) {
      throw new BadRequestException('Payment has no PaymentIntent to refund');
    }
    const original = payment.amount_cents ?? 0;
    const refundCents =
      amountCents != null ? Math.min(amountCents, original) : original;

    await this.provider.createRefund({
      paymentIntentId: payment.stripe_payment_intent_id,
      ...(amountCents != null
        ? { amount: { amountMinor: refundCents, currency: 'usd' } }
        : {}),
      reason,
    });
    return this.repo.insertRefund({
      paymentId,
      amountCents: refundCents,
      reason,
      initiatedBy: adminId,
    });
  }

  /** Webhook: finalize a refund. Marks the payment refunded and, for a
   *  marketplace order, reverses the consultant transfer + marks the order refunded. */
  async onRefundCreated(
    ev: Extract<PaymentWebhookEvent, { type: 'refund.created' }>,
  ): Promise<void> {
    const pi = ev.providerObjectId;
    const { paymentId } = await this.repo.markRefunded(pi);
    if (paymentId) await this.repo.markRefundSucceeded(paymentId);

    const order = await this.repo.findServiceOrderByPI(pi);
    if (order) {
      // REF-001: reverse the consultant transfer AT MOST ONCE.
      //
      // Stripe fires `charge.refunded` AND `refund.created` for a single
      // refund, and `StripePaymentProvider.verifyAndParseWebhook` maps both to
      // the domain type `refund.created` with the same `providerObjectId` (the
      // payment intent). They arrive as two deliveries with two different event
      // ids, so the ledger's per-event-id idempotency gate lets both through
      // and this handler ran twice — calling `reverseTransfer` twice on the
      // same transfer, with no idempotency key and no check of what had already
      // been reversed. That is real money already paid to a consultant.
      //
      // The status transition is the mutual exclusion: `setServiceOrderStatus`
      // only reports true for the call that actually moved the order out of its
      // previous state, so the second delivery reverses nothing. This holds for
      // any duplicate dispatch, not just this particular pair of Stripe events.
      const transitioned = await this.repo.setServiceOrderStatus(
        order.id,
        'refunded',
      );
      if (transitioned && order.transferId) {
        await this.provider.reverseTransfer(order.transferId);
        this.log.warn(
          `refund ${pi}: reversed consultant transfer ${order.transferId} for order ${order.id}`,
        );
      } else if (!transitioned) {
        this.log.warn(
          `refund ${pi}: order ${order.id} was already refunded — not reversing again`,
        );
      }
    }
  }
}
