import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../../config/configuration';
import type { ConsultantServiceType, PlanTier } from '@visaai/types';
import { prefillPriceCents } from '@visaai/types';
import { embeddedVisaaiId } from '../../strategies';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { PricingService } from '../pricing/pricing.service';
import { CommissionService } from '../commission/commission.service';
import { NotificationEventBus } from '../notifications/notification-event-bus';
import { SubscriptionCreditsService } from '../subscriptions/subscription-credits.service';
import { CREDIT_ELIGIBLE_SERVICES } from '../subscriptions/subscription.constants';
import { DiscountService } from '../discounts/discount.service';
import { ADDON_PRICES, type AddonSku } from './addon.constants';
import { money } from '../shared/payments/money';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type PaymentWebhookEvent,
} from '../shared/payments/payment-provider.port';
import { AnalyticsEventBus } from '../analytics/analytics-event-bus';
import { makeServerEvent } from '../analytics/events/catalog';

import { PLAN_PRICES } from './plan-prices';
import { safeLog } from '../shared/log/redact';

/**
 * The one-time form fee. The amount is per visa type — `prefillPriceCents`
 * in @visaai/types (the eTA is cheaper than the default) — and is resolved
 * from the application's own visa type here, never from the client.
 */
export const PREFILL_PRICE = {
  label: 'AI Prefilled Application Form',
};

/**
 * Server-side catalog for marketplace consultant services (cents). The client
 * never supplies the amount — it picks a serviceType and the gross is resolved
 * here, then split by the commission engine (M4 / PAY-3).
 */
export const SERVICE_PRICES: Record<
  ConsultantServiceType,
  { amount: number; label: string }
> = {
  premium_review: { amount: 14900, label: 'Premium Application Review' },
  consultation: { amount: 9900, label: 'Consultation (60 min)' },
  priority_processing: { amount: 4900, label: 'Priority Processing' },
  document_review: { amount: 7900, label: 'Document Review' },
};

@Injectable()
export class BillingService {
  private readonly log = new Logger(BillingService.name);

  constructor(
    private config: ConfigService<Env>,
    private supabase: SupabaseService,
    private pricing: PricingService,
    private commission: CommissionService,
    private notifBus: NotificationEventBus,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly credits: SubscriptionCreditsService,
    private readonly discounts: DiscountService,
    @Optional() private readonly analytics?: AnalyticsEventBus,
  ) {}

  /**
   * Checkout redirect URLs are attacker-supplied and ride on a Stripe-hosted
   * checkout page, so a lax check is a real open redirect. The prior
   * `startsWith(webUrl)` test passed `https://visaai.co.attacker.com/x` when
   * webUrl is `https://visaai.co`. Compare ORIGINS, not prefixes.
   */
  private assertRedirectAllowed(successUrl: string, cancelUrl: string): void {
    const webUrl = this.config.get('WEB_URL') || 'http://localhost:3000';
    let allowedOrigin: string;
    try {
      allowedOrigin = new URL(webUrl).origin;
    } catch {
      throw new BadRequestException('Invalid redirect URL');
    }
    const sameOrigin = (u: string): boolean => {
      try {
        return new URL(u).origin === allowedOrigin;
      } catch {
        return false;
      }
    };
    if (!sameOrigin(successUrl) || !sameOrigin(cancelUrl)) {
      throw new BadRequestException('Invalid redirect URL');
    }
  }

  /**
   * Read/persist the caller's Stripe customer id (tax + invoice + portal).
   *
   * `forceNew` discards a stored id and mints a fresh one. A customer id is
   * only valid on the account and mode that created it, so switching either —
   * as this platform did moving off a sandbox onto its own live account —
   * leaves every stored id pointing at a customer Stripe cannot see. The
   * symptom is a 500 on portal and addon checkout ("No such customer") while
   * plain checkout, which does not attach a customer, keeps working.
   */
  private async ensureCustomerId(
    userId: string,
    forceNew = false,
  ): Promise<string> {
    const { data } = await this.supabase.admin
      .from('users')
      .select('stripe_customer_id, email')
      .eq('id', userId)
      .maybeSingle();
    const row = data as {
      stripe_customer_id: string | null;
      email?: string;
    } | null;
    if (row?.stripe_customer_id && !forceNew) return row.stripe_customer_id;
    const { id } = await this.provider.ensureCustomer({
      userId,
      email: row?.email ?? '',
    });
    await this.supabase.admin
      .from('users')
      .update({ stripe_customer_id: id })
      .eq('id', userId);
    return id;
  }

  /**
   * Run a customer-scoped Stripe call, healing a stale customer id once.
   *
   * Verifying the customer up front would add a round trip to every checkout
   * for a condition that is almost never true, so this pays the cost only when
   * it actually happens: on "No such customer", mint a replacement and retry.
   */
  private async withCustomer<T>(
    userId: string,
    fn: (customerId: string) => Promise<T>,
  ): Promise<T> {
    const customerId = await this.ensureCustomerId(userId);
    try {
      return await fn(customerId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/No such customer/i.test(message)) throw err;
      this.log.warn(
        `stale Stripe customer ${customerId} for user ${userId} — recreating`,
      );
      return fn(await this.ensureCustomerId(userId, true));
    }
  }

  /** Stripe Tax + invoice flags for one-time checkouts (SP3). */
  private taxInvoiceFlags(): { collectTax: boolean; createInvoice: boolean } {
    return {
      collectTax: !!this.config.get('STRIPE_TAX_ENABLED', { infer: true }),
      createInvoice: true,
    };
  }

  /**
   * Notify the payer that a payment completed. Best-effort — a notification
   * failure must NEVER affect webhook processing / payment recording.
   */
  private notifyPayment(
    userId: string,
    paymentId: string,
    tier?: string,
  ): void {
    try {
      this.notifBus.emit({
        type: 'payment.received',
        userId,
        paymentId,
        data: tier ? { tier } : undefined,
      });
    } catch {
      /* best-effort */
    }
  }

  async createCheckoutSession(
    db: SupabaseClient,
    params: {
      userId: string;
      applicationId: string;
      planTier: Exclude<PlanTier, 'none'>;
      successUrl: string;
      cancelUrl: string;
    },
  ) {
    this.assertRedirectAllowed(params.successUrl, params.cancelUrl);

    const { data: app } = await db
      .from('applications')
      .select('id, user_id')
      .eq('id', params.applicationId)
      .eq('user_id', params.userId)
      .single();

    if (!app) throw new NotFoundException('Application not found');

    const price = PLAN_PRICES[params.planTier];

    const session = await this.provider.createCheckoutSession({
      mode: 'payment',
      lineItems: [
        {
          name: `VisaAI ${price.label}`,
          amount: money(price.amount, 'usd'),
          quantity: 1,
        },
      ],
      metadata: {
        userId: params.userId,
        applicationId: params.applicationId,
        planTier: params.planTier,
        feature: 'plan',
      },
      successUrl: params.successUrl,
      cancelUrl: params.cancelUrl,
    });

    return { url: session.url };
  }

  async createPrefillCheckoutSession(
    db: SupabaseClient,
    params: {
      userId: string;
      applicationId: string;
      successUrl: string;
      cancelUrl: string;
    },
  ) {
    this.assertRedirectAllowed(params.successUrl, params.cancelUrl);

    const { data: app } = await db
      .from('applications')
      .select('id, user_id, visa_types(visaai_id)')
      .eq('id', params.applicationId)
      .eq('user_id', params.userId)
      .single();
    if (!app) throw new NotFoundException('Application not found');

    const session = await this.provider.createCheckoutSession({
      mode: 'payment',
      lineItems: [
        {
          name: `VisaAI ${PREFILL_PRICE.label}`,
          amount: money(prefillPriceCents(embeddedVisaaiId(app)), 'usd'),
          quantity: 1,
        },
      ],
      metadata: {
        userId: params.userId,
        applicationId: params.applicationId,
        feature: 'prefill',
      },
      successUrl: params.successUrl,
      cancelUrl: params.cancelUrl,
    });

    return { url: session.url };
  }

  /**
   * Admin comp: unlock portal auto-fill without charging the form fee.
   *
   * Recorded as what it is — a `payments` row with provider 'waiver', 0 cents
   * charged and the full price as discount — so hasPaidPrefill sees it, revenue
   * sums are unaffected, and it can never be mistaken for a Stripe charge. The
   * coupon path cannot do this by design (DiscountService refuses any price at
   * or below cost). Idempotent; the audit row is part of the contract, so a
   * failed audit write rolls the waiver back.
   */
  async waivePrefillFee(
    applicationId: string,
    actorId: string,
    reason: string,
  ): Promise<{ paymentId: string; alreadyUnlocked: boolean }> {
    const db = this.supabase.admin;
    const { data: app } = await db
      .from('applications')
      .select('id, user_id, visa_types(visaai_id)')
      .eq('id', applicationId)
      .maybeSingle();
    if (!app) throw new NotFoundException('Application not found');

    const { data: existing } = await db
      .from('payments')
      .select('id')
      .eq('application_id', applicationId)
      .eq('feature', 'prefill')
      .eq('status', 'complete')
      .limit(1);
    if (existing?.length)
      return { paymentId: existing[0].id as string, alreadyUnlocked: true };

    const { data: payment, error } = await db
      .from('payments')
      .insert({
        user_id: app.user_id,
        application_id: applicationId,
        feature: 'prefill',
        status: 'complete',
        provider: 'waiver',
        amount_cents: 0,
        discount_cents: prefillPriceCents(embeddedVisaaiId(app)),
        currency: 'usd',
      })
      .select('id')
      .single();
    if (error || !payment)
      throw new Error(`prefill waiver failed: ${error?.message ?? 'no row'}`);

    const { error: auditErr } = await db.from('auth_audit_log').insert({
      user_id: app.user_id,
      actor_id: actorId,
      event_type: 'prefill_fee_waived',
      metadata: { applicationId, paymentId: payment.id, reason },
    });
    if (auditErr) {
      await db.from('payments').delete().eq('id', payment.id);
      throw new Error(`prefill waiver audit failed: ${auditErr.message}`);
    }
    return { paymentId: payment.id as string, alreadyUnlocked: false };
  }

  /**
   * Hybrid-C per-visa processing fee (PRICE-6). The price is resolved + floor-gated
   * SERVER-SIDE via PricingService — the client never supplies an amount. A
   * non-priceable / deferred / sub-floor corridor is rejected before any Stripe call.
   */
  async createProcessingFeeCheckout(
    db: SupabaseClient,
    params: {
      userId: string;
      applicationId: string;
      successUrl: string;
      cancelUrl: string;
      couponCode?: string;
    },
  ) {
    this.assertRedirectAllowed(params.successUrl, params.cancelUrl);

    const { data: app } = await db
      .from('applications')
      .select('id, user_id, framework_id, destination_country')
      .eq('id', params.applicationId)
      .eq('user_id', params.userId)
      .single();
    if (!app) throw new NotFoundException('Application not found');

    // Resolve the corridor: an attached framework gives visa_type + ISO-2 country;
    // otherwise fall back to the application's destination_country.
    let visaType: string | undefined;
    let country: string | undefined =
      (app.destination_country as string | null) ?? undefined;
    if (app.framework_id) {
      const { data: fw } = await db
        .from('country_frameworks')
        .select('visa_type, country_code')
        .eq('id', app.framework_id as string)
        .single();
      if (fw) {
        visaType = fw.visa_type as string;
        country = fw.country_code as string;
      }
    }
    if (!visaType || !country) {
      throw new BadRequestException(
        'Select a visa type and destination before checkout',
      );
    }

    // Authoritative, server-computed, floor-gated price + 'shown' audit row.
    const quote = await this.pricing.getCheckoutQuote(
      visaType,
      country,
      params.userId,
    );
    const amountCents = Math.round(quote.price * 100);

    let chargeCents = amountCents;
    const meta: Record<string, string> = {
      userId: params.userId,
      applicationId: params.applicationId,
      feature: 'processing_fee',
      visaType,
      country,
    };
    if (params.couponCode) {
      const d = await this.discounts.applyDiscount({
        visaType,
        country,
        code: params.couponCode,
        userId: params.userId,
        applicationId: params.applicationId,
        feature: 'processing_fee',
      });
      chargeCents = d.discountedCents;
      meta.couponId = d.couponId;
      meta.redemptionId = d.redemptionId;
      meta.discountCents = String(d.discountCents);
    }
    meta.amountCents = String(chargeCents);

    const customerId = await this.ensureCustomerId(params.userId);
    const flags = this.taxInvoiceFlags();
    const session = await this.provider.createCheckoutSession({
      mode: 'payment',
      lineItems: [
        {
          name: `VisaAI application processing — ${visaType} (${country})`,
          amount: money(chargeCents, 'usd'),
          quantity: 1,
        },
      ],
      metadata: meta,
      successUrl: params.successUrl,
      cancelUrl: params.cancelUrl,
      customerId,
      collectTax: flags.collectTax,
      createInvoice: flags.createInvoice,
    });

    return { url: session.url };
  }

  /**
   * One-time add-on checkout (SP3). Flat-priced (no floor gate). Optional coupon
   * applies to the add-on price. Records addon_purchases + payments on webhook.
   */
  async createAddonCheckout(
    db: SupabaseClient,
    params: {
      userId: string;
      applicationId: string;
      addonSku: AddonSku;
      couponCode?: string;
      successUrl: string;
      cancelUrl: string;
    },
  ) {
    this.assertRedirectAllowed(params.successUrl, params.cancelUrl);
    const addon = ADDON_PRICES[params.addonSku];
    if (!addon) throw new BadRequestException('Unknown add-on');

    const { data: app } = await db
      .from('applications')
      .select('id, user_id')
      .eq('id', params.applicationId)
      .eq('user_id', params.userId)
      .single();
    if (!app) throw new NotFoundException('Application not found');

    let chargeCents = addon.amount;
    const meta: Record<string, string> = {
      userId: params.userId,
      applicationId: params.applicationId,
      feature: 'addon',
      addonSku: params.addonSku,
    };
    if (params.couponCode) {
      const d = await this.discounts.applyDiscount({
        visaType: '',
        country: '',
        code: params.couponCode,
        userId: params.userId,
        applicationId: params.applicationId,
        feature: 'addon',
        listCentsOverride: addon.amount,
        cogsCentsOverride: 0,
      });
      chargeCents = d.discountedCents;
      meta.couponId = d.couponId;
      meta.redemptionId = d.redemptionId;
      meta.discountCents = String(d.discountCents);
    }
    meta.amountCents = String(chargeCents);

    const customerId = await this.ensureCustomerId(params.userId);
    const flags = this.taxInvoiceFlags();
    const session = await this.provider.createCheckoutSession({
      mode: 'payment',
      lineItems: [
        {
          name: `VisaAI ${addon.label}`,
          amount: money(chargeCents, 'usd'),
          quantity: 1,
        },
      ],
      metadata: meta,
      successUrl: params.successUrl,
      cancelUrl: params.cancelUrl,
      customerId,
      collectTax: flags.collectTax,
      createInvoice: flags.createInvoice,
    });
    return { url: session.url };
  }

  /** Stripe Billing Portal session for self-serve invoice history. */
  async createPortalSession(
    userId: string,
    returnUrl: string,
  ): Promise<{ url: string }> {
    return this.withCustomer(userId, (customerId) =>
      this.provider.createBillingPortalSession(customerId, returnUrl),
    );
  }

  /** Owner-scoped payment history: payments + add-ons + service orders. */
  async getHistory(
    db: SupabaseClient,
    userId: string,
  ): Promise<{
    payments: unknown[];
    addons: unknown[];
    serviceOrders: unknown[];
  }> {
    const [payments, addons, serviceOrders] = await Promise.all([
      db
        .from('payments')
        .select(
          'id, feature, amount_cents, currency, tax_cents, discount_cents, invoice_id, invoice_url, status, created_at',
        )
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      db
        .from('addon_purchases')
        .select('id, addon_sku, amount_cents, status, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      db
        .from('consultant_service_orders')
        .select(
          'id, service_type, amount_usd, status, credit_covered, created_at',
        )
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
    ]);
    return {
      payments: payments.data ?? [],
      addons: addons.data ?? [],
      serviceOrders: serviceOrders.data ?? [],
    };
  }

  /**
   * Marketplace service-order checkout (PAY-3). Platform is merchant of record:
   * the applicant is charged on the platform account; the consultant's cut is
   * transferred later by the payout sweep (separate charges & transfers). The
   * gross is server-resolved from SERVICE_PRICES and split by the commission
   * engine; the order is written (pending) with fee + payout owed so the webhook
   * only has to flip it to paid. See STRIPE-CONNECT.md §3.
   */
  async createServiceOrderCheckout(
    db: SupabaseClient,
    params: {
      userId: string;
      consultantId: string;
      serviceType: ConsultantServiceType;
      applicationId?: string;
      successUrl: string;
      cancelUrl: string;
    },
  ) {
    this.assertRedirectAllowed(params.successUrl, params.cancelUrl);

    const price = SERVICE_PRICES[params.serviceType];
    if (!price) throw new BadRequestException('Unknown service type');

    // Consultant must be an active marketplace profile (service-role read — the
    // profile is public marketplace data, not the caller's own row).
    const { data: consultant } = await this.supabase.admin
      .from('consultant_profiles')
      .select('id, active_status')
      .eq('id', params.consultantId)
      .maybeSingle();
    if (!consultant || consultant.active_status !== 'active') {
      throw new NotFoundException('Consultant not available');
    }

    // If tied to an application, verify ownership (RLS client) + derive corridor.
    let country: string | null = null;
    let visa: string | null = null;
    if (params.applicationId) {
      const { data: app } = await db
        .from('applications')
        .select('id, user_id, framework_id, destination_country')
        .eq('id', params.applicationId)
        .eq('user_id', params.userId)
        .single();
      if (!app) throw new NotFoundException('Application not found');
      country = (app.destination_country as string | null) ?? null;
      if (app.framework_id) {
        const { data: fw } = await db
          .from('country_frameworks')
          .select('visa_type, country_code')
          .eq('id', app.framework_id as string)
          .single();
        if (fw) {
          visa = fw.visa_type as string;
          country = fw.country_code as string;
        }
      }
    }

    const grossUsd = price.amount / 100;
    const splitResult = await this.commission.splitFor({
      gross: grossUsd,
      country,
      visa,
      consultantId: params.consultantId,
    });

    // Subscription review-credit path (premium_review only). A consumed credit
    // creates a paid-by-credit order and skips checkout; overage routes to paid.
    // The consultant is still paid via the payout sweep; the platform absorbs the
    // cost against subscription revenue (the cap is what protects margin).
    const creditEligible =
      this.config.get('SUBSCRIPTIONS_ENABLED', { infer: true }) &&
      CREDIT_ELIGIBLE_SERVICES.includes(params.serviceType);
    if (creditEligible) {
      const consumed = await this.credits.tryConsume(
        params.userId,
        params.applicationId ?? null,
      );
      if (consumed) {
        const { data: creditOrder, error: creditErr } =
          await this.supabase.admin
            .from('consultant_service_orders')
            .insert({
              user_id: params.userId,
              consultant_id: params.consultantId,
              application_id: params.applicationId ?? null,
              service_type: params.serviceType,
              currency: 'usd',
              amount_usd: splitResult.gross_usd,
              platform_fee_usd: splitResult.platform_fee_usd,
              consultant_payout_usd: splitResult.consultant_payout_usd,
              commission_rule_id: splitResult.rule_id,
              status: 'paid',
              paid_at: new Date().toISOString(),
              credit_covered: true,
            })
            .select('id')
            .single();
        if (creditErr) throw creditErr;
        return { serviceOrderId: String(creditOrder.id), creditCovered: true };
      }
    }

    // Pay-in row (service-role: order writes are system-only — see migration §8).
    const { data: order, error } = await this.supabase.admin
      .from('consultant_service_orders')
      .insert({
        user_id: params.userId,
        consultant_id: params.consultantId,
        application_id: params.applicationId ?? null,
        service_type: params.serviceType,
        currency: 'usd',
        amount_usd: splitResult.gross_usd,
        platform_fee_usd: splitResult.platform_fee_usd,
        consultant_payout_usd: splitResult.consultant_payout_usd,
        commission_rule_id: splitResult.rule_id,
        status: 'pending',
      })
      .select('id')
      .single();
    if (error) throw error;

    const session = await this.provider.createCheckoutSession({
      mode: 'payment',
      lineItems: [
        {
          name: `VisaAI ${price.label}`,
          amount: money(price.amount, 'usd'),
          quantity: 1,
        },
      ],
      metadata: {
        userId: params.userId,
        applicationId: params.applicationId ?? '',
        consultantId: params.consultantId,
        serviceOrderId: String(order.id),
        feature: 'service_order',
      },
      successUrl: params.successUrl,
      cancelUrl: params.cancelUrl,
    });

    return { url: session.url, serviceOrderId: String(order.id) };
  }

  /**
   * Domain effects for a completed checkout. Called by PaymentWebhookService
   * after signature verification + the event-level ledger idempotency gate, so
   * this method assumes it runs at-most-once per event and no longer verifies
   * the signature or re-checks the PaymentIntent. The payments.stripe_payment_intent_id
   * UNIQUE constraint remains as a defense-in-depth backstop.
   */
  async recordCheckoutCompleted(
    ev: Extract<PaymentWebhookEvent, { type: 'checkout.completed' }>,
  ): Promise<void> {
    const meta = ev.metadata;
    const paymentIntentId = ev.providerObjectId;
    const { userId, applicationId, planTier, feature } = meta;

    // Common capture: tax + discount + invoice (SP3), from the parsed event.
    // Hoisted above the service_order branch so both paths can report the
    // same allowlisted amount/currency to analytics.
    const amountCents = ev.amount
      ? ev.amount.amountMinor
      : meta.amountCents
        ? Number(meta.amountCents)
        : null;
    const currency = ev.amount ? ev.amount.currency : 'usd';

    // PAY-4: marketplace service order. Mark paid (idempotent on status); the
    // commission was computed + stored at checkout — re-affirm only.
    if (feature === 'service_order') {
      const serviceOrderId = meta.serviceOrderId;
      if (!serviceOrderId) return;
      const { data: order } = await this.supabase.admin
        .from('consultant_service_orders')
        .select('id, status')
        .eq('id', serviceOrderId)
        .maybeSingle();
      if (!order || order.status === 'paid') return; // not found / already done
      await this.supabase.admin
        .from('consultant_service_orders')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          stripe_payment_intent_id: paymentIntentId,
        })
        .eq('id', serviceOrderId)
        .eq('status', 'pending');
      this.analytics?.emitSafe(
        makeServerEvent('payment.succeeded', {
          user_id: userId ?? null,
          application_id: applicationId ?? null,
          props: { amount_cents: amountCents, currency, kind: 'service_order' },
        }),
      );
      return;
    }

    const baseRow = {
      user_id: userId,
      application_id: applicationId,
      stripe_payment_intent_id: paymentIntentId,
      currency,
      provider: 'stripe',
      status: 'complete',
      tax_cents: ev.taxMinor ?? null,
      discount_cents: ev.discountMinor ?? null,
      invoice_id: ev.invoiceId ?? null,
    };

    // SP3: one-time add-on.
    if (feature === 'addon') {
      const payId = await this.insertPayment(
        { ...baseRow, feature: 'addon', amount_cents: amountCents },
        { userId, paymentIntentId, feature: 'addon' },
      );
      const { error: addonErr } = await this.supabase.admin
        .from('addon_purchases')
        .insert({
          user_id: userId,
          application_id: applicationId,
          payment_id: payId,
          addon_sku: meta.addonSku,
          amount_cents: amountCents ?? 0,
          stripe_payment_intent_id: paymentIntentId,
          status: 'complete',
        });
      if (addonErr)
        safeLog.error(
          'billing',
          `ADD-ON NOT RECORDED — customer was charged. user=${userId} ` +
            `intent=${paymentIntentId} sku=${meta.addonSku}: ${addonErr.message}`,
        );
      await this.afterPaid(
        meta,
        payId,
        userId,
        paymentIntentId,
        'addon',
        amountCents,
        currency,
      );
      return;
    }

    // Hybrid-C per-visa processing fee (PRICE-6): price was server-computed +
    // floor-gated at checkout; record the corridor + charged amount.
    if (feature === 'processing_fee') {
      const payId = await this.insertPayment(
        {
          ...baseRow,
          feature: 'processing_fee',
          visa_type: meta.visaType ?? null,
          country_code: meta.country ?? null,
          amount_cents: amountCents,
        },
        { userId, paymentIntentId, feature: 'processing_fee' },
      );
      await this.afterPaid(
        meta,
        payId,
        userId,
        paymentIntentId,
        'processing_fee',
        amountCents,
        currency,
      );
      return;
    }

    const resolvedFeature = feature === 'prefill' ? 'prefill' : 'plan';
    const payId = await this.insertPayment(
      {
        ...baseRow,
        plan_tier: resolvedFeature === 'plan' ? planTier : null,
        feature: resolvedFeature,
        amount_cents: amountCents,
      },
      { userId, paymentIntentId, feature: resolvedFeature },
    );
    await this.afterPaid(
      meta,
      payId,
      userId,
      paymentIntentId,
      resolvedFeature,
      amountCents,
      currency,
      resolvedFeature === 'plan' ? planTier : undefined,
    );

    if (resolvedFeature === 'plan') {
      await this.supabase.admin
        .from('applications')
        .update({ plan_tier: planTier })
        .eq('id', applicationId)
        .eq('user_id', userId);
    }
  }

  /**
   * Insert the `payments` row and SAY SO when it does not land.
   *
   * All three call sites did `const { data: pay } = await ...insert(...)` with
   * no `error`. supabase-js resolves a failed insert as `{ data: null, error }`
   * rather than rejecting, so a failed insert simply produced `pay = null`, the
   * code passed `pay?.id ?? null` onward, notified the customer that their
   * payment succeeded, and — on the plan branch — granted `plan_tier` on the
   * application. Entitlement granted, nothing in `payments`: the customer is on
   * a paid plan that no revenue total, reconciliation run or tax statement can
   * see, and nothing anywhere reports a problem.
   *
   * This does NOT throw, deliberately. `PaymentWebhookService.handle` records
   * the provider event id as its idempotency gate BEFORE dispatching, so a
   * handler that throws gets its Stripe retry discarded as a duplicate and the
   * side effects never run at all — no entitlement AND no record. Until that
   * gate only closes on success (see REVIEW_HANDOFF.md), the correct trade is
   * to keep the entitlement the customer paid for and make the accounting hole
   * loud and greppable instead of silent.
   */
  private async insertPayment(
    row: Record<string, unknown>,
    ctx: { userId: string; paymentIntentId: string; feature: string },
  ): Promise<string | null> {
    const { data, error } = await this.supabase.admin
      .from('payments')
      .insert(row)
      .select('id')
      .single();
    if (error) {
      safeLog.error(
        'billing',
        `PAYMENT NOT RECORDED — entitlement will still be granted. ` +
          `user=${ctx.userId} intent=${ctx.paymentIntentId} ` +
          `feature=${ctx.feature}: ${error.message}`,
      );
      return null;
    }
    return (data as { id: string } | null)?.id ?? null;
  }

  /** Post-payment side effects: notify + analytics + coupon redemption linkage (SP3). */
  private async afterPaid(
    meta: Record<string, string>,
    paymentId: string | null,
    userId: string,
    paymentIntentId: string,
    feature: string,
    amountCents: number | null,
    currency: string,
    tier?: string,
  ): Promise<void> {
    this.notifyPayment(userId, paymentIntentId, tier);
    this.analytics?.emitSafe(
      makeServerEvent('payment.succeeded', {
        user_id: userId ?? null,
        application_id: meta.applicationId ?? null,
        props: { amount_cents: amountCents, currency, kind: feature },
      }),
    );
    if (meta.couponId) {
      await this.discounts.redeem(meta.couponId);
      if (meta.redemptionId && paymentId) {
        await this.discounts.linkRedemptionPayment(
          meta.redemptionId,
          paymentId,
        );
      }
    }
  }
}
