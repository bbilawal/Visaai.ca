import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../shared/supabase/supabase.service';
import type {
  PaymentEventRecord,
  PaymentEventRecorder,
} from '../shared/payments/payment-event-recorder.port';

/**
 * Append-only payment ledger writer plus its separate mutable processing state.
 * Claiming is one database transaction: it records the immutable evidence and
 * acquires a lease. An event becomes a duplicate only after its handler marks
 * it processed, so a transient handler failure remains retryable.
 */
@Injectable()
export class LedgerService implements PaymentEventRecorder {
  constructor(private readonly supabase: SupabaseService) {}

  async claim(
    input: PaymentEventRecord,
  ): Promise<'claimed' | 'processed' | 'processing'> {
    const { data, error } = await this.supabase.admin.rpc(
      'claim_payment_webhook_event',
      {
        p_provider: input.provider,
        p_event_type: input.eventType,
        p_provider_event_id: input.providerEventId,
        p_provider_object_id: input.providerObjectId,
        p_amount_minor: input.amount?.amountMinor ?? null,
        p_currency: input.amount?.currency ?? null,
        p_direction: input.direction,
        p_user_id: input.userId ?? null,
        p_related_entity: input.relatedEntity ?? {},
        p_occurred_at: input.occurredAt.toISOString(),
      },
    );
    if (error) throw new Error(error.message ?? 'payment webhook claim failed');
    if (data === 'claimed' || data === 'processed' || data === 'processing') {
      return data;
    }
    throw new Error('payment webhook claim returned an invalid state');
  }

  async markProcessed(providerEventId: string): Promise<void> {
    const { error } = await this.supabase.admin.rpc(
      'complete_payment_webhook_event',
      { p_provider_event_id: providerEventId },
    );
    if (error)
      throw new Error(error.message ?? 'payment webhook completion failed');
  }

  async markFailed(
    providerEventId: string,
    errorMessage: string,
  ): Promise<void> {
    const { error } = await this.supabase.admin.rpc(
      'fail_payment_webhook_event',
      {
        p_provider_event_id: providerEventId,
        p_error: errorMessage.slice(0, 1000),
      },
    );
    if (error)
      throw new Error(
        error.message ?? 'payment webhook failure recording failed',
      );
  }
}
