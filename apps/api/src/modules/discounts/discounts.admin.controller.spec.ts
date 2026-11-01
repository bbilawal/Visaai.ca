import { CouponAdminController } from './discounts.admin.controller';

function makeProvider() {
  return {
    name: 'stripe',
    createCoupon: jest.fn().mockResolvedValue({ id: 'co_1' }),
  } as any;
}
function makeRepo() {
  return { createCoupon: jest.fn().mockResolvedValue({ id: 'c1' }) } as any;
}

describe('CouponAdminController', () => {
  it('mints a Stripe coupon then persists the row', async () => {
    const provider = makeProvider();
    const repo = makeRepo();
    const c = new CouponAdminController(provider, repo);
    const res = await c.create({
      code: 'FAMILY20',
      kind: 'percent',
      percentOff: 20,
      appliesTo: 'processing_fee',
    });
    expect(provider.createCoupon).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'percent', percentOff: 20 }),
    );
    expect(repo.createCoupon).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'FAMILY20', stripeCouponId: 'co_1' }),
    );
    expect(res).toEqual({ id: 'c1' });
  });
});
