import {
  computeEarnings,
  groupSweepable,
  mapAccountStatus,
  roundCents,
  settlementTransfer,
  type SweepableOrder,
} from './payouts.engine';

const order = (over: Partial<SweepableOrder> = {}): SweepableOrder => ({
  service_order_id: 'o1',
  consultant_id: 'c1',
  consultant_payout_usd: 80,
  amount_usd: 100,
  currency: 'usd',
  stripe_connect_account_id: 'acct_1',
  payouts_enabled: true,
  stripe_payment_intent_id: 'pi_1',
  ...over,
});

describe('settlementTransfer', () => {
  // The live failure this exists for: a CA platform billing USD settles into
  // CAD, and Stripe rejects `source_transaction` unless the transfer is
  // denominated in the settlement currency.
  //   "The currency of source_transaction's balance transaction (cad) must be
  //    the same as the transfer currency (usd)"
  it('converts the USD obligation into the settlement currency by share of the settled gross', () => {
    const move = settlementTransfer(
      { consultant_payout_usd: 39.2, currency: 'usd' },
      49,
      { settlementCurrency: 'cad', settledAmountMinor: 6700 }, // $49 -> C$67.00
    );
    // 39.20/49 = 80% of the settled gross, i.e. the CAD equivalent of $39.20
    // at the exact rate Stripe applied to this charge. No FX table involved.
    expect(move).toEqual({ amountMinor: 5360, currency: 'cad' });
  });

  it('pays the owed amount unchanged when settlement matches the order currency', () => {
    const move = settlementTransfer(
      { consultant_payout_usd: 200, currency: 'usd' },
      250,
      { settlementCurrency: 'usd', settledAmountMinor: 25000 },
    );
    expect(move).toEqual({ amountMinor: 20000, currency: 'usd' });
  });

  it('falls back to the order currency when the charge has not settled', () => {
    const move = settlementTransfer(
      { consultant_payout_usd: 39.2, currency: 'usd' },
      49,
      null,
    );
    expect(move).toEqual({ amountMinor: 3920, currency: 'usd' });
  });

  it('does not divide by a zero gross', () => {
    const move = settlementTransfer(
      { consultant_payout_usd: 10, currency: 'usd' },
      0,
      { settlementCurrency: 'cad', settledAmountMinor: 5000 },
    );
    expect(move).toEqual({ amountMinor: 1000, currency: 'usd' });
  });

  it('rounds to whole minor units so Stripe never sees a fractional cent', () => {
    const move = settlementTransfer(
      { consultant_payout_usd: 33.33, currency: 'usd' },
      100,
      { settlementCurrency: 'cad', settledAmountMinor: 13701 },
    );
    expect(Number.isInteger(move.amountMinor)).toBe(true);
    expect(move.amountMinor).toBe(Math.round(13701 * 0.3333));
  });
});

describe('payouts.engine', () => {
  describe('roundCents', () => {
    it('rounds to cents without float drift', () => {
      expect(roundCents(1.005)).toBe(1.01);
      expect(roundCents(80.005 + 80.005)).toBe(160.01);
    });
  });

  describe('mapAccountStatus', () => {
    it('verified when the transfers capability is active, payouts enabled and details submitted', () => {
      expect(
        mapAccountStatus({
          id: 'a',
          details_submitted: true,
          payouts_enabled: true,
          capabilities: { transfers: 'active' },
        }),
      ).toEqual({ kyc_status: 'verified', payouts_enabled: true });
    });

    it('holds payouts while the transfers capability is not active, even if payouts_enabled', () => {
      expect(
        mapAccountStatus({
          id: 'a',
          details_submitted: true,
          payouts_enabled: true,
          capabilities: { transfers: 'inactive' },
        }),
      ).toEqual({ kyc_status: 'pending', payouts_enabled: false });
    });

    it('holds payouts while Stripe cannot pay the account out, even with transfers active', () => {
      // Deliberate policy choice: we only transfer once the consultant can
      // actually withdraw, so earnings never strand in a Stripe balance they
      // cannot reach. Stripe alone would permit the transfer here.
      expect(
        mapAccountStatus({
          id: 'a',
          details_submitted: true,
          payouts_enabled: false,
          capabilities: { transfers: 'active' },
        }),
      ).toEqual({ kyc_status: 'pending', payouts_enabled: false });
    });

    it('ignores charges_enabled — recipient accounts are never merchant of record', () => {
      expect(
        mapAccountStatus({
          id: 'a',
          details_submitted: true,
          payouts_enabled: true,
          charges_enabled: false,
          capabilities: { transfers: 'active' },
        }),
      ).toEqual({ kyc_status: 'verified', payouts_enabled: true });
    });

    it('pending while onboarding incomplete', () => {
      expect(mapAccountStatus({ id: 'a', details_submitted: false })).toEqual({
        kyc_status: 'pending',
        payouts_enabled: false,
      });
    });

    it('rejected when requirements.disabled_reason starts with rejected', () => {
      expect(
        mapAccountStatus({
          id: 'a',
          details_submitted: true,
          payouts_enabled: true,
          capabilities: { transfers: 'active' },
          requirements: { disabled_reason: 'rejected.fraud' },
        }),
      ).toEqual({ kyc_status: 'rejected', payouts_enabled: true });
    });
  });

  describe('groupSweepable', () => {
    it('groups one transfer per consultant and sums payouts', () => {
      const groups = groupSweepable([
        order({
          service_order_id: 'o1',
          consultant_id: 'c1',
          consultant_payout_usd: 80,
        }),
        order({
          service_order_id: 'o2',
          consultant_id: 'c1',
          consultant_payout_usd: 40,
        }),
        order({
          service_order_id: 'o3',
          consultant_id: 'c2',
          consultant_payout_usd: 30,
          stripe_connect_account_id: 'acct_2',
        }),
      ]);
      const c1 = groups.find((g) => g.consultant_id === 'c1')!;
      const c2 = groups.find((g) => g.consultant_id === 'c2')!;
      expect(c1.total_usd).toBe(120);
      expect(c1.orders).toHaveLength(2);
      expect(c1.connect_account_id).toBe('acct_1');
      expect(c2.total_usd).toBe(30);
    });

    it('excludes consultants without payouts enabled or no connect account', () => {
      const groups = groupSweepable([
        order({ consultant_id: 'c1', payouts_enabled: false }),
        order({
          service_order_id: 'o2',
          consultant_id: 'c2',
          stripe_connect_account_id: null,
        }),
      ]);
      expect(groups).toHaveLength(0);
    });

    it('drops zero-total groups', () => {
      const groups = groupSweepable([order({ consultant_payout_usd: 0 })]);
      expect(groups).toHaveLength(0);
    });
  });

  describe('computeEarnings', () => {
    it('pending = lifetime − paid_out, clamped to >= 0', () => {
      expect(
        computeEarnings('c1', {
          lifetime_usd: 200,
          paid_out_usd: 120,
          orders_count: 3,
        }),
      ).toEqual({
        consultant_id: 'c1',
        currency: 'usd',
        lifetime_usd: 200,
        paid_out_usd: 120,
        pending_usd: 80,
        orders_count: 3,
      });
    });

    it('never returns negative pending', () => {
      const e = computeEarnings('c1', {
        lifetime_usd: 100,
        paid_out_usd: 140,
        orders_count: 2,
      });
      expect(e.pending_usd).toBe(0);
    });
  });
});
