import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../shared/supabase/supabase.service';
import type {
  ISubscriptionsRepository,
  SubscriptionRow,
  UpsertSubscriptionInput,
} from './subscriptions.repository';

@Injectable()
export class SubscriptionsRepository implements ISubscriptionsRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async getActiveByUser(userId: string): Promise<SubscriptionRow | null> {
    const { data } = await this.supabase.admin
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['active', 'trialing'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as SubscriptionRow) ?? null;
  }

  async getByStripeId(
    stripeSubscriptionId: string,
  ): Promise<SubscriptionRow | null> {
    const { data } = await this.supabase.admin
      .from('subscriptions')
      .select('*')
      .eq('stripe_subscription_id', stripeSubscriptionId)
      .maybeSingle();
    return (data as SubscriptionRow) ?? null;
  }

  async upsertFromStripe(input: UpsertSubscriptionInput): Promise<void> {
    const { error } = await this.supabase.admin.from('subscriptions').upsert(
      {
        user_id: input.userId,
        stripe_subscription_id: input.stripeSubscriptionId,
        stripe_customer_id: input.stripeCustomerId,
        plan: input.plan,
        status: input.status,
        billing_interval: input.billingInterval,
        current_period_start: input.currentPeriodStart?.toISOString() ?? null,
        current_period_end: input.currentPeriodEnd?.toISOString() ?? null,
        cancel_at_period_end: input.cancelAtPeriodEnd,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'stripe_subscription_id' },
    );
    if (error) {
      throw new Error(
        (error as { message?: string }).message ?? 'subscription upsert failed',
      );
    }
  }

  async getCurrentCredits(
    subscriptionId: string,
  ): Promise<{ granted: number; consumed: number } | null> {
    const now = new Date().toISOString();
    const { data } = await this.supabase.admin
      .from('subscription_credits')
      .select('granted, consumed')
      .eq('subscription_id', subscriptionId)
      .lte('period_start', now)
      .gte('period_end', now)
      .maybeSingle();
    return data ?? null;
  }
}
