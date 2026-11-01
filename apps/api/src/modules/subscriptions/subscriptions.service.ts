import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/configuration';
import { SupabaseService } from '../shared/supabase/supabase.service';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from '../shared/payments/payment-provider.port';
import {
  SUBSCRIPTIONS_REPOSITORY,
  type ISubscriptionsRepository,
  type SubscriptionRow,
} from './subscriptions.repository';
import {
  parsePriceCatalog,
  resolvePriceId,
  type BillingInterval,
  type SubPlan,
} from './subscription.constants';

@Injectable()
export class SubscriptionsService {
  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(SUBSCRIPTIONS_REPOSITORY)
    private readonly repo: ISubscriptionsRepository,
    private readonly config: ConfigService<Env>,
    private readonly supabase: SupabaseService,
  ) {}

  private priceId(plan: SubPlan, interval: BillingInterval): string {
    const catalog = parsePriceCatalog(
      this.config.get('SUBSCRIPTION_PRICES', { infer: true }),
    );
    if (!catalog)
      throw new NotFoundException('Subscription prices not configured');
    return resolvePriceId(catalog, plan, interval);
  }

  private async ensureCustomerId(
    userId: string,
    email: string,
  ): Promise<string> {
    const { data } = await this.supabase.admin
      .from('users')
      .select('stripe_customer_id')
      .eq('id', userId)
      .maybeSingle();
    const existing = data?.stripe_customer_id;
    if (existing) return existing;
    const { id } = await this.provider.ensureCustomer({ userId, email });
    await this.supabase.admin
      .from('users')
      .update({ stripe_customer_id: id })
      .eq('id', userId);
    return id;
  }

  async startCheckout(
    userId: string,
    email: string,
    args: {
      plan: SubPlan;
      interval: BillingInterval;
      successUrl: string;
      cancelUrl: string;
    },
  ): Promise<{ url: string }> {
    const customerId = await this.ensureCustomerId(userId, email);
    const trialDays =
      this.config.get('SUBSCRIPTION_TRIAL_DAYS', { infer: true }) || 0;
    const session = await this.provider.createSubscriptionCheckoutSession({
      priceId: this.priceId(args.plan, args.interval),
      customerId,
      trialDays: trialDays > 0 ? trialDays : undefined,
      metadata: { userId, plan: args.plan, interval: args.interval },
      clientReferenceId: userId,
      successUrl: args.successUrl,
      cancelUrl: args.cancelUrl,
    });
    return { url: session.url };
  }

  private async requireActive(userId: string): Promise<SubscriptionRow> {
    const sub = await this.repo.getActiveByUser(userId);
    if (!sub) throw new NotFoundException('No active subscription');
    return sub;
  }

  async change(
    userId: string,
    args: { plan: SubPlan; interval: BillingInterval },
  ): Promise<{ ok: true }> {
    const sub = await this.requireActive(userId);
    await this.provider.updateSubscription(sub.stripe_subscription_id, {
      priceId: this.priceId(args.plan, args.interval),
      prorationBehavior: 'create_prorations',
    });
    return { ok: true };
  }

  async pause(userId: string): Promise<{ ok: true }> {
    const sub = await this.requireActive(userId);
    await this.provider.pauseSubscription(sub.stripe_subscription_id);
    return { ok: true };
  }

  async resume(userId: string): Promise<{ ok: true }> {
    const sub = await this.requireActive(userId);
    await this.provider.resumeSubscription(sub.stripe_subscription_id);
    return { ok: true };
  }

  async cancel(userId: string, immediate: boolean): Promise<{ ok: true }> {
    const sub = await this.requireActive(userId);
    await this.provider.cancelSubscription(sub.stripe_subscription_id, {
      atPeriodEnd: !immediate,
    });
    return { ok: true };
  }

  async getMine(userId: string): Promise<{
    subscription: SubscriptionRow | null;
    credits: { granted: number; consumed: number; remaining: number } | null;
  }> {
    const subscription = await this.repo.getActiveByUser(userId);
    if (!subscription) return { subscription: null, credits: null };
    const c = await this.repo.getCurrentCredits(subscription.id);
    return {
      subscription,
      credits: c ? { ...c, remaining: c.granted - c.consumed } : null,
    };
  }
}
