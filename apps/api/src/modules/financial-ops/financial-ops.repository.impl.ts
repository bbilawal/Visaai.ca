import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../shared/supabase/supabase.service';
import type {
  IFinancialOpsRepository,
  PaymentLite,
  ReportDimension,
  RevenueSummary,
} from './financial-ops.repository';

const DIM_COLUMN: Record<ReportDimension, string> = {
  country: 'country_code',
  visa: 'visa_type',
  plan: 'plan_tier',
  feature: 'feature',
};

@Injectable()
export class FinancialOpsRepository implements IFinancialOpsRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async getPayment(paymentId: string): Promise<PaymentLite | null> {
    const { data } = await this.supabase.admin
      .from('payments')
      .select('id, stripe_payment_intent_id, amount_cents, status, feature')
      .eq('id', paymentId)
      .maybeSingle();
    return data ?? null;
  }

  async insertRefund(input: {
    paymentId: string;
    stripeRefundId?: string | null;
    amountCents: number;
    reason?: string;
    initiatedBy: string;
  }): Promise<{ id: string }> {
    const { data, error } = await this.supabase.admin
      .from('refunds')
      .insert({
        payment_id: input.paymentId,
        stripe_refund_id: input.stripeRefundId ?? null,
        amount_cents: input.amountCents,
        reason: input.reason ?? null,
        initiated_by: input.initiatedBy,
        status: 'pending',
      })
      .select('id')
      .single();
    if (error)
      throw new Error(
        (error as { message?: string }).message ?? 'refund insert failed',
      );
    return { id: data.id };
  }

  async markRefunded(
    paymentIntentId: string,
  ): Promise<{ paymentId: string | null }> {
    const { data } = await this.supabase.admin
      .from('payments')
      .update({ status: 'refunded' })
      .eq('stripe_payment_intent_id', paymentIntentId)
      .select('id')
      .maybeSingle();
    return { paymentId: (data?.id as string) ?? null };
  }

  async markRefundSucceeded(paymentId: string): Promise<void> {
    await this.supabase.admin
      .from('refunds')
      .update({ status: 'succeeded' })
      .eq('payment_id', paymentId)
      .eq('status', 'pending');
  }

  async findServiceOrderByPI(
    paymentIntentId: string,
  ): Promise<{ id: string; transferId: string | null } | null> {
    const { data: order } = await this.supabase.admin
      .from('consultant_service_orders')
      .select('id')
      .eq('stripe_payment_intent_id', paymentIntentId)
      .maybeSingle();
    if (!order) return null;
    const { data: item } = await this.supabase.admin
      .from('consultant_payout_items')
      .select('payout_id')
      .eq('service_order_id', order.id)
      .maybeSingle();
    let transferId: string | null = null;
    if (item?.payout_id) {
      const { data: payout } = await this.supabase.admin
        .from('consultant_payouts')
        .select('stripe_transfer_id')
        .eq('id', item.payout_id)
        .maybeSingle();
      transferId = (payout?.stripe_transfer_id as string) ?? null;
    }
    return { id: order.id, transferId };
  }

  async setServiceOrderStatus(id: string, status: string): Promise<boolean> {
    // Conditional on the order not ALREADY being in the target state, and
    // reporting whether this call is the one that moved it. That makes the
    // update itself the mutual exclusion for a once-only side effect, instead
    // of an unconditional write that tells the caller nothing.
    const { data, error } = await this.supabase.admin
      .from('consultant_service_orders')
      .update({ status })
      .eq('id', id)
      .neq('status', status)
      .select('id');
    if (error) throw error;
    return (data ?? []).length > 0;
  }

  async upsertDispute(input: {
    stripeDisputeId: string;
    providerObjectId: string;
    amountCents: number | null;
    currency: string | null;
    reason?: string;
    status: string;
  }): Promise<void> {
    await this.supabase.admin.from('payment_disputes').upsert(
      {
        stripe_dispute_id: input.stripeDisputeId,
        provider_object_id: input.providerObjectId,
        amount_cents: input.amountCents,
        currency: input.currency,
        reason: input.reason ?? null,
        status: input.status,
      },
      { onConflict: 'stripe_dispute_id', ignoreDuplicates: true },
    );
  }

  async markPaymentDisputed(providerObjectId: string): Promise<void> {
    await this.supabase.admin
      .from('payments')
      .update({ disputed_at: new Date().toISOString() })
      .eq('stripe_payment_intent_id', providerObjectId);
  }

  async listDisputes(): Promise<unknown[]> {
    const { data } = await this.supabase.admin
      .from('payment_disputes')
      .select('*')
      .order('created_at', { ascending: false });
    return data ?? [];
  }

  async markPaymentFailed(paymentIntentId: string): Promise<void> {
    await this.supabase.admin
      .from('payments')
      .update({ status: 'failed' })
      .eq('stripe_payment_intent_id', paymentIntentId)
      .eq('status', 'pending');
  }

  async listPastDueSubscriptions(): Promise<
    { id: string; stripe_subscription_id: string }[]
  > {
    const { data } = await this.supabase.admin
      .from('subscriptions')
      .select('id, stripe_subscription_id')
      .eq('status', 'past_due');
    return data ?? [];
  }

  async getDunning(
    subscriptionId: string,
  ): Promise<{ attempts: number; status: string } | null> {
    const { data } = await this.supabase.admin
      .from('payment_dunning')
      .select('attempts, status')
      .eq('subscription_id', subscriptionId)
      .maybeSingle();
    return data ?? null;
  }

  async upsertDunning(subscriptionId: string): Promise<void> {
    await this.supabase.admin
      .from('payment_dunning')
      .upsert(
        { subscription_id: subscriptionId, status: 'active' },
        { onConflict: 'subscription_id', ignoreDuplicates: true },
      );
  }

  async incrementDunning(subscriptionId: string): Promise<void> {
    const current = await this.getDunning(subscriptionId);
    await this.supabase.admin
      .from('payment_dunning')
      .update({
        attempts: (current?.attempts ?? 0) + 1,
        last_attempt_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('subscription_id', subscriptionId);
  }

  async setDunningStatus(
    subscriptionId: string,
    status: string,
  ): Promise<void> {
    await this.supabase.admin
      .from('payment_dunning')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('subscription_id', subscriptionId);
  }

  private async paymentsInRange(
    fromIso: string,
    toIso: string,
  ): Promise<
    {
      amount_cents: number | null;
      status: string;
      country_code: string | null;
      visa_type: string | null;
      plan_tier: string | null;
      feature: string | null;
    }[]
  > {
    const { data } = await this.supabase.admin
      .from('payments')
      .select(
        'amount_cents, status, country_code, visa_type, plan_tier, feature',
      )
      .gte('created_at', fromIso)
      .lt('created_at', toIso);
    return data ?? [];
  }

  async revenueSummary(
    fromIso: string,
    toIso: string,
  ): Promise<RevenueSummary> {
    const rows = await this.paymentsInRange(fromIso, toIso);
    let collectedCents = 0;
    let refundedCents = 0;
    let count = 0;
    for (const r of rows) {
      const amt = r.amount_cents ?? 0;
      if (r.status === 'complete') {
        collectedCents += amt;
        count += 1;
      } else if (r.status === 'refunded') {
        refundedCents += amt;
      }
    }
    return {
      collectedCents,
      refundedCents,
      netCents: collectedCents - refundedCents,
      count,
    };
  }

  async revenueByDimension(
    fromIso: string,
    toIso: string,
    dim: ReportDimension,
  ): Promise<{ key: string; netCents: number }[]> {
    const col = DIM_COLUMN[dim];
    const rows = await this.paymentsInRange(fromIso, toIso);
    const acc = new Map<string, number>();
    for (const r of rows) {
      const amt = r.amount_cents ?? 0;
      const key = String((r as Record<string, unknown>)[col] ?? 'unknown');
      const delta =
        r.status === 'complete' ? amt : r.status === 'refunded' ? -amt : 0;
      if (delta !== 0) acc.set(key, (acc.get(key) ?? 0) + delta);
    }
    return [...acc.entries()].map(([key, netCents]) => ({ key, netCents }));
  }
}
