import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  PAYMENT_EVENT_RECORDER,
  type PaymentEventRecorder,
} from './payment-event-recorder.port';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type PaymentWebhookEvent,
  type WebhookKind,
} from './payment-provider.port';

export interface WebhookDomainHandlers {
  onCheckoutCompleted(
    ev: Extract<PaymentWebhookEvent, { type: 'checkout.completed' }>,
  ): Promise<void>;
  onConnectAccountUpdated(
    ev: Extract<PaymentWebhookEvent, { type: 'connect.account.updated' }>,
  ): Promise<void>;
  onTransferReversed(
    ev: Extract<PaymentWebhookEvent, { type: 'transfer.reversed' }>,
  ): Promise<void>;
  onSubscriptionChanged(
    ev: Extract<PaymentWebhookEvent, { type: 'subscription.updated' }>,
  ): Promise<void>;
  onInvoicePaid(
    ev: Extract<PaymentWebhookEvent, { type: 'invoice.paid' }>,
  ): Promise<void>;
  onInvoicePaymentFailed(
    ev: Extract<PaymentWebhookEvent, { type: 'invoice.payment_failed' }>,
  ): Promise<void>;
  onRefundCreated(
    ev: Extract<PaymentWebhookEvent, { type: 'refund.created' }>,
  ): Promise<void>;
  onDisputeCreated(
    ev: Extract<PaymentWebhookEvent, { type: 'dispute.created' }>,
  ): Promise<void>;
  onPaymentFailed(
    ev: Extract<PaymentWebhookEvent, { type: 'payment.failed' }>,
  ): Promise<void>;
}

/**
 * Provider-agnostic webhook entrypoint. Verifies the signature, records the
 * event to the append-only ledger, acquires a durable processing lease, then
 * dispatches domain side-effects. A duplicate is skipped only after completion;
 * failed attempts are released for provider retries. Providers never leak into
 * domain code.
 */
@Injectable()
export class PaymentWebhookService {
  private readonly log = new Logger(PaymentWebhookService.name);
  private handlers: Partial<WebhookDomainHandlers> = {};

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(PAYMENT_EVENT_RECORDER)
    private readonly ledger: PaymentEventRecorder,
  ) {}

  registerHandlers(h: Partial<WebhookDomainHandlers>): void {
    this.handlers = { ...this.handlers, ...h };
  }

  async handle(
    rawBody: Buffer,
    signature: string,
    kind: WebhookKind,
  ): Promise<void> {
    const ev = this.provider.verifyAndParseWebhook(rawBody, signature, kind);

    const state = await this.ledger.claim({
      provider: this.provider.name,
      eventType: ev.type,
      providerEventId: ev.providerEventId,
      providerObjectId: ev.providerObjectId,
      amount: ev.amount ?? null,
      direction: ev.type === 'refund.created' ? 'debit' : 'credit',
      userId: ev.metadata.userId ?? null,
      relatedEntity: ev.metadata,
      occurredAt: new Date(),
    });
    if (state === 'processed') {
      this.log.debug(
        `duplicate webhook ${ev.providerEventId} — skipping dispatch`,
      );
      return;
    }
    if (state === 'processing') {
      // Do not acknowledge a concurrent or crashed attempt: a 5xx makes the
      // provider retry, and the database lease can be reclaimed after timeout.
      throw new ServiceUnavailableException(
        'payment webhook is already processing',
      );
    }

    try {
      switch (ev.type) {
        case 'checkout.completed':
          await this.handlers.onCheckoutCompleted?.(ev);
          break;
        case 'connect.account.updated':
          await this.handlers.onConnectAccountUpdated?.(ev);
          break;
        case 'transfer.reversed':
          await this.handlers.onTransferReversed?.(ev);
          break;
        case 'subscription.updated':
          await this.handlers.onSubscriptionChanged?.(ev);
          break;
        case 'invoice.paid':
          await this.handlers.onInvoicePaid?.(ev);
          break;
        case 'invoice.payment_failed':
          await this.handlers.onInvoicePaymentFailed?.(ev);
          break;
        case 'refund.created':
          await this.handlers.onRefundCreated?.(ev);
          break;
        case 'dispute.created':
          await this.handlers.onDisputeCreated?.(ev);
          break;
        case 'payment.failed':
          await this.handlers.onPaymentFailed?.(ev);
          break;
        default:
          // Unknown events are deliberately retained as processed ledger evidence.
          break;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'webhook handler failed';
      await this.ledger.markFailed(ev.providerEventId, message);
      throw error;
    }
    await this.ledger.markProcessed(ev.providerEventId);
  }
}
