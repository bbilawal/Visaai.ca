import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingService } from './billing.service';

function makeDb(app: any) {
  return {
    from: jest.fn().mockReturnValue({
      select: () => ({
        eq: () => ({ eq: () => ({ single: () => ({ data: app }) }) }),
      }),
    }),
  } as any;
}

const config = new ConfigService({
  WEB_URL: 'https://app.visaai.test',
  STRIPE_SECRET_KEY: 'sk',
  STRIPE_WEBHOOK_SECRET: 'wh',
});

function makeService() {
  const supabase: any = { admin: { from: jest.fn() } };
  const pricing: any = { getCheckoutQuote: jest.fn() };
  const commission: any = { splitFor: jest.fn() };
  const notifBus: any = { emit: jest.fn() };
  const provider: any = { name: 'stripe', createCheckoutSession: jest.fn() };
  const svc = new BillingService(
    config,
    supabase,
    pricing,
    commission,
    notifBus,
    provider,
    { tryConsume: jest.fn().mockResolvedValue(null) } as any, // SubscriptionCreditsService
    { resolve: jest.fn().mockResolvedValue(null) } as any, // DiscountService
  );
  return { svc, provider, supabase, pricing };
}

describe('BillingService characterization (behavior preserved post-refactor)', () => {
  it('rejects a redirect URL outside WEB_URL', async () => {
    const { svc } = makeService();
    await expect(
      svc.createCheckoutSession(makeDb({ id: 'a1', user_id: 'u1' }), {
        userId: 'u1',
        applicationId: 'a1',
        planTier: 'copilot',
        successUrl: 'https://evil.com/ok',
        cancelUrl: 'https://app.visaai.test/no',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // Open-redirect regression: a prefix check let a look-alike host that merely
  // STARTS WITH the allowed URL through. The origin check rejects it.
  it('rejects a look-alike host that only prefix-matches WEB_URL', async () => {
    const { svc } = makeService();
    await expect(
      svc.createCheckoutSession(makeDb({ id: 'a1', user_id: 'u1' }), {
        userId: 'u1',
        applicationId: 'a1',
        planTier: 'copilot',
        successUrl: 'https://app.visaai.test.attacker.com/ok',
        cancelUrl: 'https://app.visaai.test/no',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('plan checkout charges the catalog price in usd (Money) and returns the session url', async () => {
    const { svc, provider } = makeService();
    provider.createCheckoutSession.mockResolvedValue({
      id: 'cs',
      url: 'https://checkout/x',
      paymentIntentId: 'pi',
    });
    const res = await svc.createCheckoutSession(
      makeDb({ id: 'a1', user_id: 'u1' }),
      {
        userId: 'u1',
        applicationId: 'a1',
        planTier: 'copilot',
        successUrl: 'https://app.visaai.test/ok',
        cancelUrl: 'https://app.visaai.test/no',
      },
    );
    expect(res).toEqual({ url: 'https://checkout/x' });
    const arg = provider.createCheckoutSession.mock.calls[0][0];
    expect(arg.lineItems[0].amount).toEqual({
      amountMinor: 3000,
      currency: 'usd',
    }); // copilot
    expect(arg.metadata.feature).toBe('plan');
  });
});
