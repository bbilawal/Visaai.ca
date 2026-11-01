import { ConfigService } from '@nestjs/config';
import { BillingService } from './billing.service';

const config = new ConfigService({
  WEB_URL: 'https://app.visaai.test',
  STRIPE_SECRET_KEY: 'sk',
  STRIPE_WEBHOOK_SECRET: 'wh',
});

function make() {
  const paymentInsert = jest.fn().mockReturnValue({
    select: () => ({ single: () => ({ data: { id: 'pay_1' }, error: null }) }),
  });
  const addonInsert = jest.fn().mockResolvedValue({ error: null });
  const admin = {
    from: jest.fn((t: string) => {
      if (t === 'payments') return { insert: paymentInsert };
      if (t === 'addon_purchases') return { insert: addonInsert };
      throw new Error(`unexpected ${t}`);
    }),
  };
  const supabase: any = { admin };
  const discounts = {
    redeem: jest.fn().mockResolvedValue(true),
    linkRedemptionPayment: jest.fn().mockResolvedValue(undefined),
  };
  const svc = new BillingService(
    config,
    supabase,
    {} as any,
    {} as any,
    { emit: jest.fn() } as any,
    { name: 'stripe' } as any,
    {} as any,
    discounts as any,
  );
  return { svc, paymentInsert, addonInsert, discounts };
}

describe('recordCheckoutCompleted SP3', () => {
  it('processing_fee persists tax/discount/invoice + redeems coupon', async () => {
    const { svc, paymentInsert, discounts } = make();
    await svc.recordCheckoutCompleted({
      type: 'checkout.completed',
      providerEventId: 'e',
      providerObjectId: 'pi_1',
      amount: { amountMinor: 30000, currency: 'usd' },
      taxMinor: 2000,
      discountMinor: 4900,
      invoiceId: 'in_1',
      metadata: {
        feature: 'processing_fee',
        userId: 'u1',
        applicationId: 'a1',
        visaType: 'trv',
        country: 'CA',
        couponId: 'c1',
        redemptionId: 'red_1',
      },
      raw: {},
    } as any);
    const row = paymentInsert.mock.calls[0][0];
    expect(row).toEqual(
      expect.objectContaining({
        feature: 'processing_fee',
        tax_cents: 2000,
        discount_cents: 4900,
        invoice_id: 'in_1',
      }),
    );
    expect(discounts.redeem).toHaveBeenCalledWith('c1');
    expect(discounts.linkRedemptionPayment).toHaveBeenCalledWith(
      'red_1',
      'pay_1',
    );
  });

  it('addon inserts a payments row + an addon_purchases row', async () => {
    const { svc, addonInsert } = make();
    await svc.recordCheckoutCompleted({
      type: 'checkout.completed',
      providerEventId: 'e2',
      providerObjectId: 'pi_2',
      amount: { amountMinor: 7900, currency: 'usd' },
      invoiceId: 'in_2',
      metadata: {
        feature: 'addon',
        userId: 'u1',
        applicationId: 'a1',
        addonSku: 'addon_document_review',
      },
      raw: {},
    } as any);
    expect(addonInsert.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        addon_sku: 'addon_document_review',
        payment_id: 'pay_1',
        status: 'complete',
      }),
    );
  });
});
