import { ConfigService } from '@nestjs/config';
import { BillingService } from './billing.service';

const config = new ConfigService({
  WEB_URL: 'https://app.visaai.test',
  STRIPE_SECRET_KEY: 'sk',
  STRIPE_WEBHOOK_SECRET: 'wh',
  STRIPE_TAX_ENABLED: true,
});

function deps() {
  const app = {
    id: 'a1',
    user_id: 'u1',
    destination_country: 'CA',
    framework_id: 'fw1',
  };
  const db: any = {
    from: (t: string) => {
      if (t === 'country_frameworks') {
        return {
          select: () => ({
            eq: () => ({
              single: () => ({
                data: { visa_type: 'trv', country_code: 'CA' },
              }),
            }),
          }),
        };
      }
      // applications
      return {
        select: () => ({
          eq: () => ({ eq: () => ({ single: () => ({ data: app }) }) }),
        }),
      };
    },
  };
  const supabase: any = {
    admin: {
      from: jest.fn().mockReturnValue({
        select: () => ({
          eq: () => ({
            maybeSingle: () => ({ data: { stripe_customer_id: 'cus_1' } }),
          }),
        }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }),
    },
  };
  const pricing = {
    getCheckoutQuote: jest.fn().mockResolvedValue({ price: 349 }),
  };
  const provider = {
    name: 'stripe',
    ensureCustomer: jest.fn().mockResolvedValue({ id: 'cus_1' }),
    createCheckoutSession: jest.fn().mockResolvedValue({
      id: 'cs',
      url: 'https://co/x',
      paymentIntentId: 'pi',
    }),
    createBillingPortalSession: jest
      .fn()
      .mockResolvedValue({ url: 'https://portal/x' }),
  };
  const discounts = {
    applyDiscount: jest.fn().mockResolvedValue({
      discountedCents: 30000,
      couponId: 'c1',
      redemptionId: 'red_1',
      discountCents: 4900,
      listCents: 34900,
    }),
  };
  const svc = new BillingService(
    config,
    supabase,
    pricing as any,
    {} as any,
    { emit: jest.fn() } as any,
    provider as any,
    {} as any,
    discounts as any,
  );
  return { svc, db, provider, discounts };
}

describe('BillingService SP3', () => {
  it('processing fee with coupon charges the discounted amount + tax/invoice flags', async () => {
    const { svc, db, provider, discounts } = deps();
    await svc.createProcessingFeeCheckout(db, {
      userId: 'u1',
      applicationId: 'a1',
      successUrl: 'https://app.visaai.test/ok',
      cancelUrl: 'https://app.visaai.test/no',
      couponCode: 'FAMILY20',
    });
    expect(discounts.applyDiscount).toHaveBeenCalled();
    const arg = provider.createCheckoutSession.mock.calls[0][0];
    expect(arg.lineItems[0].amount).toEqual({
      amountMinor: 30000,
      currency: 'usd',
    });
    expect(arg.collectTax).toBe(true);
    expect(arg.createInvoice).toBe(true);
    expect(arg.metadata.couponId).toBe('c1');
    expect(arg.metadata.redemptionId).toBe('red_1');
  });

  it('processing fee without coupon charges list price', async () => {
    const { svc, db, provider } = deps();
    await svc.createProcessingFeeCheckout(db, {
      userId: 'u1',
      applicationId: 'a1',
      successUrl: 'https://app.visaai.test/ok',
      cancelUrl: 'https://app.visaai.test/no',
    });
    expect(
      provider.createCheckoutSession.mock.calls[0][0].lineItems[0].amount
        .amountMinor,
    ).toBe(34900);
  });

  it('addon checkout builds the addon line item (feature=addon)', async () => {
    const { svc, db, provider } = deps();
    await svc.createAddonCheckout(db, {
      userId: 'u1',
      applicationId: 'a1',
      addonSku: 'addon_document_review',
      successUrl: 'https://app.visaai.test/ok',
      cancelUrl: 'https://app.visaai.test/no',
    });
    const arg = provider.createCheckoutSession.mock.calls[0][0];
    expect(arg.metadata.feature).toBe('addon');
    expect(arg.metadata.addonSku).toBe('addon_document_review');
    expect(arg.lineItems[0].amount.amountMinor).toBe(7900);
  });

  it('createPortalSession returns the portal url', async () => {
    const { svc, provider } = deps();
    const r = await svc.createPortalSession(
      'u1',
      'https://app.visaai.test/billing',
    );
    expect(r).toEqual({ url: 'https://portal/x' });
    expect(provider.createBillingPortalSession).toHaveBeenCalledWith(
      'cus_1',
      'https://app.visaai.test/billing',
    );
  });
});
