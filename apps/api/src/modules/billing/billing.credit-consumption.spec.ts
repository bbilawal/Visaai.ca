import { ConfigService } from '@nestjs/config';
import { BillingService } from './billing.service';

const config = new ConfigService({
  WEB_URL: 'https://app.visaai.test',
  STRIPE_SECRET_KEY: 'sk',
  STRIPE_WEBHOOK_SECRET: 'wh',
  SUBSCRIPTIONS_ENABLED: true,
});

function makeDeps(consumeResult: boolean) {
  const consultant = { id: 'c1', active_status: 'active' };
  const insertOrder = jest.fn().mockReturnValue({
    select: () => ({ single: () => ({ data: { id: 'ord_1' }, error: null }) }),
  });
  const admin = {
    from: jest.fn((t: string) => {
      if (t === 'consultant_profiles')
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => ({ data: consultant }) }),
          }),
        };
      if (t === 'consultant_service_orders') return { insert: insertOrder };
      throw new Error(`unexpected ${t}`);
    }),
  };
  const supabase: any = { admin };
  const db: any = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: () => ({
              data: {
                id: 'a1',
                user_id: 'u1',
                destination_country: 'CA',
                framework_id: null,
              },
            }),
          }),
        }),
      }),
    }),
  };
  const commission = {
    splitFor: jest.fn().mockResolvedValue({
      gross_usd: 149,
      platform_fee_usd: 44.7,
      consultant_payout_usd: 104.3,
      rule_id: 'r1',
    }),
  };
  const provider = {
    name: 'stripe',
    createCheckoutSession: jest.fn().mockResolvedValue({
      id: 'cs',
      url: 'https://co/x',
      paymentIntentId: 'pi',
    }),
  };
  const credits = { tryConsume: jest.fn().mockResolvedValue(consumeResult) };
  const svc = new BillingService(
    config,
    supabase,
    {} as any,
    commission as any,
    { emit: jest.fn() } as any,
    provider as any,
    credits as any,
    { resolve: jest.fn().mockResolvedValue(null) } as any, // DiscountService (8th dep)
  );
  return { svc, db, provider, insertOrder, credits };
}

describe('premium_review credit consumption', () => {
  it('consumes a credit → creates a paid-by-credit order, no checkout', async () => {
    const { svc, db, provider, insertOrder, credits } = makeDeps(true);
    const res = await svc.createServiceOrderCheckout(db, {
      userId: 'u1',
      consultantId: 'c1',
      serviceType: 'premium_review',
      applicationId: 'a1',
      successUrl: 'https://app.visaai.test/ok',
      cancelUrl: 'https://app.visaai.test/no',
    });
    expect(credits.tryConsume).toHaveBeenCalledWith('u1', 'a1');
    expect(res).toEqual({ serviceOrderId: 'ord_1', creditCovered: true });
    expect(provider.createCheckoutSession).not.toHaveBeenCalled();
    expect(insertOrder.mock.calls[0][0]).toEqual(
      expect.objectContaining({ status: 'paid', credit_covered: true }),
    );
  });

  it('no credit → overage-to-paid checkout (existing path)', async () => {
    const { svc, db, provider, credits } = makeDeps(false);
    const res = await svc.createServiceOrderCheckout(db, {
      userId: 'u1',
      consultantId: 'c1',
      serviceType: 'premium_review',
      applicationId: 'a1',
      successUrl: 'https://app.visaai.test/ok',
      cancelUrl: 'https://app.visaai.test/no',
    });
    expect(credits.tryConsume).toHaveBeenCalled();
    expect(provider.createCheckoutSession).toHaveBeenCalled();
    expect((res as any).url).toBe('https://co/x');
  });
});
