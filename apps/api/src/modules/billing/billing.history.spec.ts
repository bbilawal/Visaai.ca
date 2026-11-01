import { ConfigService } from '@nestjs/config';
import { BillingService } from './billing.service';

const config = new ConfigService({
  WEB_URL: 'https://app.visaai.test',
  STRIPE_SECRET_KEY: 'sk',
  STRIPE_WEBHOOK_SECRET: 'wh',
});

function makeDb(rows: Record<string, any[]>) {
  return {
    from: jest.fn((t: string) => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: rows[t] ?? [], error: null }),
        }),
      }),
    })),
  } as any;
}

it('getHistory returns owner payments, addons, service orders', async () => {
  const svc = new BillingService(
    config,
    {} as any,
    {} as any,
    {} as any,
    { emit: jest.fn() } as any,
    { name: 'stripe' } as any,
    {} as any,
    {} as any,
  );
  const db = makeDb({
    payments: [{ id: 'p1', feature: 'processing_fee', invoice_url: null }],
    addon_purchases: [{ id: 'ad1', addon_sku: 'addon_document_review' }],
    consultant_service_orders: [{ id: 'o1', service_type: 'premium_review' }],
  });
  const res = await svc.getHistory(db, 'u1');
  expect(res.payments).toHaveLength(1);
  expect(res.addons).toHaveLength(1);
  expect(res.serviceOrders).toHaveLength(1);
});
