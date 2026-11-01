import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PaymentWebhookEvent } from '../shared/payments/payment-provider.port';
import {
  FINANCIAL_OPS_REPOSITORY,
  type IFinancialOpsRepository,
} from './financial-ops.repository';

@Injectable()
export class DisputeService {
  private readonly log = new Logger(DisputeService.name);

  constructor(
    @Inject(FINANCIAL_OPS_REPOSITORY)
    private readonly repo: IFinancialOpsRepository,
  ) {}

  /** Webhook: record a chargeback/dispute + flag the payment. No auto-evidence. */
  async onDisputeCreated(
    ev: Extract<PaymentWebhookEvent, { type: 'dispute.created' }>,
  ): Promise<void> {
    const stripeDisputeId = ev.metadata.disputeId || ev.providerEventId;
    await this.repo.upsertDispute({
      stripeDisputeId,
      providerObjectId: ev.providerObjectId,
      amountCents: ev.amount ? ev.amount.amountMinor : null,
      currency: ev.amount ? ev.amount.currency : null,
      reason: ev.metadata.reason,
      status: 'open',
    });
    await this.repo.markPaymentDisputed(ev.providerObjectId);
    this.log.warn(`dispute opened for ${ev.providerObjectId}`);
  }

  listDisputes(): Promise<unknown[]> {
    return this.repo.listDisputes();
  }
}
