import { PAYMENT_PROVIDER } from './payment-provider.port';
import type { PaymentWebhookEvent } from './payment-provider.port';

describe('payment-provider port', () => {
  it('exposes a stable DI symbol', () => {
    expect(typeof PAYMENT_PROVIDER).toBe('symbol');
    expect(PAYMENT_PROVIDER.toString()).toContain('PAYMENT_PROVIDER');
  });

  it('webhook event union is exhaustively narrowable', () => {
    const ev: PaymentWebhookEvent = {
      type: 'checkout.completed',
      providerEventId: 'evt_1',
      providerObjectId: 'pi_1',
      amount: { amountMinor: 2900, currency: 'usd' },
      metadata: { feature: 'plan' },
      raw: {},
    };
    const label = ev.type === 'checkout.completed' ? 'checkout' : 'other';
    expect(label).toBe('checkout');
  });
});
