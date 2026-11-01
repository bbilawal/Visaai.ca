import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscriptionsController } from './subscriptions.controller';

const user = { id: 'u1', email: 'u@x.com' } as any;
const enabled = new ConfigService({
  SUBSCRIPTIONS_ENABLED: true,
  WEB_URL: 'https://app.test',
});
const disabled = new ConfigService({ SUBSCRIPTIONS_ENABLED: false });

function makeSvc() {
  return {
    startCheckout: jest.fn().mockResolvedValue({ url: 'https://co/s' }),
    change: jest.fn().mockResolvedValue({ ok: true }),
    cancel: jest.fn().mockResolvedValue({ ok: true }),
    getMine: jest.fn().mockResolvedValue({ subscription: null, credits: null }),
    pause: jest.fn(),
    resume: jest.fn(),
  } as any;
}

describe('SubscriptionsController', () => {
  it('rejects when flag disabled', async () => {
    const c = new SubscriptionsController(makeSvc(), disabled);
    await expect(
      c.checkout(user, {
        plan: 'pro',
        interval: 'month',
        successUrl: 'https://app.test/ok',
        cancelUrl: 'https://app.test/no',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('delegates checkout when enabled', async () => {
    const svc = makeSvc();
    const c = new SubscriptionsController(svc, enabled);
    const res = await c.checkout(user, {
      plan: 'pro',
      interval: 'month',
      successUrl: 'https://app.test/ok',
      cancelUrl: 'https://app.test/no',
    });
    expect(res).toEqual({ url: 'https://co/s' });
    expect(svc.startCheckout).toHaveBeenCalledWith(
      'u1',
      'u@x.com',
      expect.objectContaining({ plan: 'pro', interval: 'month' }),
    );
  });
});
