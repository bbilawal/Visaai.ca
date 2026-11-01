import { DiscountsRepository } from './discounts.repository.impl';

function makeSupabase(over: any) {
  return {
    admin: { from: jest.fn((t: string) => over[t]), rpc: over.rpc },
  } as any;
}

describe('DiscountsRepository', () => {
  it('getActiveByCode reads an active coupon', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({
      data: { id: 'c1', code: 'FAMILY20', active: true },
    });
    const repo = new DiscountsRepository(
      makeSupabase({
        coupons: {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }),
        },
      }),
    );
    const c = await repo.getActiveByCode('FAMILY20');
    expect(c?.id).toBe('c1');
  });

  it('insertRedemption writes the ledger row', async () => {
    const single = jest
      .fn()
      .mockResolvedValue({ data: { id: 'red_1' }, error: null });
    const insert = jest.fn().mockReturnValue({ select: () => ({ single }) });
    const repo = new DiscountsRepository(
      makeSupabase({ discount_redemptions: { insert } }),
    );
    const r = await repo.insertRedemption({
      couponId: 'c1',
      userId: 'u1',
      applicationId: 'a1',
      listPriceCents: 34900,
      discountCents: 4900,
      chargedPriceCents: 30000,
      resultingMargin: 0.56,
      floorOk: true,
    });
    expect(r.id).toBe('red_1');
    expect(insert.mock.calls[0][0]).toEqual(
      expect.objectContaining({ floor_ok: true, charged_price_cents: 30000 }),
    );
  });

  it('redeem calls the atomic RPC', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: true, error: null });
    const repo = new DiscountsRepository(makeSupabase({ rpc }));
    expect(await repo.redeem('c1')).toBe(true);
    expect(rpc).toHaveBeenCalledWith('redeem_coupon', { p_coupon_id: 'c1' });
  });
});
