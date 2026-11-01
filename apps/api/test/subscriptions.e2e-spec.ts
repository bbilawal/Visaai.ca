import { Test } from '@nestjs/testing';
import {
  PAYMENT_PROVIDER,
  type PaymentWebhookEvent,
} from '../src/modules/shared/payments/payment-provider.port';
import { PAYMENT_EVENT_RECORDER } from '../src/modules/shared/payments/payment-event-recorder.port';
import { PaymentWebhookService } from '../src/modules/shared/payments/payment-webhook.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { SupabaseService } from '../src/modules/shared/supabase/supabase.service';
import { SubscriptionsRepository } from '../src/modules/subscriptions/subscriptions.repository.impl';
import { SubscriptionCreditsService } from '../src/modules/subscriptions/subscription-credits.service';
import { SUBSCRIPTIONS_REPOSITORY } from '../src/modules/subscriptions/subscriptions.repository';
import { paymentWebhookRpc } from './fakes/payment-webhook-rpc.fake';

describe('subscription webhook pipeline (e2e)', () => {
  function makeFakeSupabase() {
    const subs: any[] = [];
    const credits: any[] = [];
    const ledger: Record<string, any[]> = {};
    const admin = {
      rpc: paymentWebhookRpc(ledger),
      from(table: string) {
        if (table === 'payment_events') {
          return { insert: () => Promise.resolve({ error: null }) };
        }
        if (table === 'subscriptions') {
          return {
            upsert: (row: any) => {
              const i = subs.findIndex(
                (s) => s.stripe_subscription_id === row.stripe_subscription_id,
              );
              if (i >= 0) subs[i] = { ...subs[i], ...row };
              else subs.push({ id: 'row_' + (subs.length + 1), ...row });
              return Promise.resolve({ error: null });
            },
            select: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: subs[0] ?? null }),
              }),
            }),
          };
        }
        if (table === 'subscription_credits') {
          return {
            upsert: (row: any, opts: any) => {
              const dup = credits.find(
                (c) =>
                  c.subscription_id === row.subscription_id &&
                  c.period_start === row.period_start,
              );
              if (!(opts?.ignoreDuplicates && dup)) credits.push(row);
              return Promise.resolve({ error: null });
            },
          };
        }
        throw new Error(`unexpected ${table}`);
      },
    };
    return { subs, credits, service: { admin } as unknown as SupabaseService };
  }

  async function build(fake: SupabaseService, event: PaymentWebhookEvent) {
    const provider = {
      name: 'stripe',
      verifyAndParseWebhook: () => event,
    } as any;
    return Test.createTestingModule({
      providers: [
        PaymentWebhookService,
        LedgerService,
        SubscriptionsRepository,
        SubscriptionCreditsService,
        {
          provide: SUBSCRIPTIONS_REPOSITORY,
          useExisting: SubscriptionsRepository,
        },
        { provide: PAYMENT_PROVIDER, useValue: provider },
        // Mirrors ledger.module.ts. PaymentWebhookService takes the
        // PAYMENT_EVENT_RECORDER port, not LedgerService — the ARCH-003
        // refactor that broke the shared->ledger cycle. These specs still
        // registered the concrete class only, so DI could not resolve.
        { provide: PAYMENT_EVENT_RECORDER, useExisting: LedgerService },
        { provide: SupabaseService, useValue: fake },
      ],
    }).compile();
  }

  it('subscription.updated upserts the row; invoice.paid grants the pro cap once', async () => {
    const fake = makeFakeSupabase();

    const subEvent: PaymentWebhookEvent = {
      type: 'subscription.updated',
      providerEventId: 'e_su',
      providerObjectId: 'sub_1',
      amount: null,
      metadata: {},
      raw: {
        id: 'sub_1',
        customer: 'cus_1',
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: 1_751_328_000,
        current_period_end: 1_753_920_000,
        items: { data: [{ price: { id: 'price_pm' } }] },
        metadata: { userId: 'u1' },
      },
    };
    let ref = await build(fake.service, subEvent);
    const webhook = ref.get(PaymentWebhookService);
    const repo = ref.get(SubscriptionsRepository);
    const credits = ref.get(SubscriptionCreditsService);
    webhook.registerHandlers({
      onSubscriptionChanged: async (ev) => {
        const s = ev.raw as any;
        await repo.upsertFromStripe({
          userId: s.metadata.userId,
          stripeSubscriptionId: s.id,
          stripeCustomerId: s.customer,
          plan: 'pro',
          status: s.status,
          billingInterval: 'month',
          currentPeriodStart: new Date(s.current_period_start * 1000),
          currentPeriodEnd: new Date(s.current_period_end * 1000),
          cancelAtPeriodEnd: false,
        });
      },
      onInvoicePaid: async (ev) => {
        const sub = await repo.getByStripeId(ev.providerObjectId);
        if (!sub) return;
        await credits.grantForPeriod({
          subscriptionId: sub.id,
          userId: sub.user_id,
          plan: 'pro',
          periodStart: new Date(sub.current_period_start!),
          periodEnd: new Date(sub.current_period_end!),
        });
      },
    });
    await webhook.handle(Buffer.from('{}'), 's', 'platform');
    expect(fake.subs).toHaveLength(1);

    const inv: PaymentWebhookEvent = {
      type: 'invoice.paid',
      providerEventId: 'e_ip',
      providerObjectId: 'sub_1',
      amount: { amountMinor: 4900, currency: 'usd' },
      metadata: {},
      raw: {},
    };
    ref = await build(fake.service, inv);
    const wh2 = ref.get(PaymentWebhookService);
    const repo2 = ref.get(SubscriptionsRepository);
    const credits2 = ref.get(SubscriptionCreditsService);
    wh2.registerHandlers({
      onInvoicePaid: async (ev) => {
        const sub = await repo2.getByStripeId(ev.providerObjectId);
        if (!sub) return;
        await credits2.grantForPeriod({
          subscriptionId: sub.id,
          userId: sub.user_id,
          plan: 'pro',
          periodStart: new Date(sub.current_period_start!),
          periodEnd: new Date(sub.current_period_end!),
        });
      },
    });
    await wh2.handle(Buffer.from('{}'), 's', 'platform');
    await wh2.handle(Buffer.from('{}'), 's', 'platform'); // re-delivery — ledger dedupe blocks 2nd

    expect(
      fake.credits.filter((c) => c.subscription_id === fake.subs[0].id),
    ).toHaveLength(1);
    expect(fake.credits[0].granted).toBe(1); // pro cap
  });
});
