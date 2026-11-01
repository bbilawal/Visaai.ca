import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectService } from './connect.service';
import type { IPayoutsRepository, PayoutProfile } from './payouts.repository';
import type { IPayoutsStripe } from './payouts.stripe';

function makeRepo(over: Partial<IPayoutsRepository> = {}): IPayoutsRepository {
  const notImpl = (n: string) => () => {
    throw new Error(`unexpected repo call: ${n}`);
  };
  const base: IPayoutsRepository = {
    getProfileByUserId: notImpl('getProfileByUserId'),
    getProfileById: notImpl('getProfileById'),
    setConnectAccountId: notImpl('setConnectAccountId'),
    syncKycByAccountId: notImpl('syncKycByAccountId'),
    listSweepableOrders: notImpl('listSweepableOrders'),
    recordPayout: notImpl('recordPayout'),
    getEarnings: notImpl('getEarnings'),
    // These five were absent: the `...over` spread of a Partial widened every
    // member to optional, so the mock silently under-implemented the interface.
    listPayoutsByConsultant: notImpl('listPayoutsByConsultant'),
    markPayoutReversed: notImpl('markPayoutReversed'),
    upsertTaxProfile: notImpl('upsertTaxProfile'),
    getTaxProfile: notImpl('getTaxProfile'),
    sumPaidForYear: notImpl('sumPaidForYear'),
    upsertTaxStatement: notImpl('upsertTaxStatement'),
    listConsultantsWithPaidPayouts: notImpl('listConsultantsWithPaidPayouts'),
  };
  return Object.assign(base, over);
}

function makeStripe(over: Partial<IPayoutsStripe> = {}): IPayoutsStripe {
  const notImpl = (n: string) => () => {
    throw new Error(`unexpected stripe call: ${n}`);
  };
  const base: IPayoutsStripe = {
    createExpressAccount: notImpl('createExpressAccount'),
    createAccountLink: notImpl('createAccountLink'),
    createTransfer: notImpl('createTransfer'),
    resolveChargeFunding: notImpl('resolveChargeFunding'),
    createExpressDashboardLink: notImpl('createExpressDashboardLink'),
  };
  return Object.assign(base, over);
}

const config = new ConfigService({ WEB_URL: 'https://app.visaai.test' });

const profile = (over: Partial<PayoutProfile> = {}): PayoutProfile => ({
  id: 'c1',
  user_id: 'u1',
  email: 'consultant@example.com',
  country: 'CA',
  stripe_connect_account_id: null,
  kyc_status: 'none',
  payouts_enabled: false,
  ...over,
});

describe('ConnectService', () => {
  describe('onboardingLink', () => {
    it('creates an Express account on first use then returns the link', async () => {
      const createExpressAccount = jest
        .fn()
        .mockResolvedValue({ id: 'acct_new' });
      const setConnectAccountId = jest.fn().mockResolvedValue(true);
      const createAccountLink = jest
        .fn()
        .mockResolvedValue({ url: 'https://connect.stripe/onboard' });
      const svc = new ConnectService(
        makeRepo({
          getProfileByUserId: jest.fn().mockResolvedValue(profile()),
          setConnectAccountId,
        }),
        makeStripe({ createExpressAccount, createAccountLink }),
        config,
      );

      const out = await svc.onboardingLink('u1');

      expect(createExpressAccount).toHaveBeenCalledWith({
        country: 'CA',
        email: 'consultant@example.com',
        metadata: { consultant_id: 'c1' },
      });
      expect(setConnectAccountId).toHaveBeenCalledWith('c1', 'acct_new', {
        onlyIfUnset: true,
      });
      expect(createAccountLink).toHaveBeenCalledWith(
        expect.objectContaining({ account: 'acct_new' }),
      );
      expect(out).toEqual({
        url: 'https://connect.stripe/onboard',
        account_id: 'acct_new',
      });
    });

    it('reuses an existing Connect account (no create)', async () => {
      const createExpressAccount = jest.fn();
      const createAccountLink = jest
        .fn()
        .mockResolvedValue({ url: 'https://connect.stripe/resume' });
      const svc = new ConnectService(
        makeRepo({
          getProfileByUserId: jest
            .fn()
            .mockResolvedValue(
              profile({ stripe_connect_account_id: 'acct_old' }),
            ),
        }),
        makeStripe({ createExpressAccount, createAccountLink }),
        config,
      );

      const out = await svc.onboardingLink('u1');
      expect(createExpressAccount).not.toHaveBeenCalled();
      expect(out.account_id).toBe('acct_old');
    });

    // A connected-account id is only valid on the platform account + mode that
    // minted it, so every stored id goes dead after a Stripe cutover. Before
    // this, ensureAccount returned the stale id unchecked and onboarding 500'd.
    it('mints a replacement when the stored account is gone from this platform', async () => {
      const createExpressAccount = jest
        .fn()
        .mockResolvedValue({ id: 'acct_fresh' });
      const setConnectAccountId = jest.fn().mockResolvedValue(true);
      const createAccountLink = jest
        .fn()
        .mockImplementationOnce(() => {
          throw Object.assign(new Error("No such account: 'acct_sandbox'"), {
            code: 'resource_missing',
          });
        })
        .mockResolvedValue({ url: 'https://connect.stripe/onboard' });

      const svc = new ConnectService(
        makeRepo({
          getProfileByUserId: jest
            .fn()
            .mockResolvedValue(
              profile({ stripe_connect_account_id: 'acct_sandbox' }),
            ),
          setConnectAccountId,
        }),
        makeStripe({ createExpressAccount, createAccountLink }),
        config,
      );

      const out = await svc.onboardingLink('u1');

      expect(createAccountLink).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ account: 'acct_sandbox' }),
      );
      expect(createExpressAccount).toHaveBeenCalledTimes(1);
      expect(setConnectAccountId).toHaveBeenCalledWith('c1', 'acct_fresh', {
        onlyIfUnset: false,
      });
      expect(out).toEqual({
        url: 'https://connect.stripe/onboard',
        account_id: 'acct_fresh',
      });
    });

    // The verbatim message /v1/account_links returned on live 2026-08-12. It
    // says neither "No such account" nor code resource_missing, so the first
    // version of this fix let it through and onboarding still 500'd.
    it('heals on the account_links wording, which omits resource_missing', async () => {
      const createExpressAccount = jest
        .fn()
        .mockResolvedValue({ id: 'acct_fresh' });
      const setConnectAccountId = jest.fn().mockResolvedValue(true);
      const createAccountLink = jest
        .fn()
        .mockRejectedValueOnce(
          new Error(
            'You requested an account link for an account that is not connected to your platform or does not exist.',
          ),
        )
        .mockResolvedValue({ url: 'https://connect.stripe/onboard' });

      const svc = new ConnectService(
        makeRepo({
          getProfileByUserId: jest
            .fn()
            .mockResolvedValue(
              profile({ stripe_connect_account_id: 'acct_sandbox' }),
            ),
          setConnectAccountId,
        }),
        makeStripe({ createExpressAccount, createAccountLink }),
        config,
      );

      const out = await svc.onboardingLink('u1');
      expect(setConnectAccountId).toHaveBeenCalledWith('c1', 'acct_fresh', {
        onlyIfUnset: false,
      });
      expect(out.account_id).toBe('acct_fresh');
    });

    it('propagates a non-missing-account Stripe failure without minting', async () => {
      const createExpressAccount = jest.fn();
      const createAccountLink = jest
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('rate limited'), { code: 'rate_limit' }),
        );
      const svc = new ConnectService(
        makeRepo({
          getProfileByUserId: jest
            .fn()
            .mockResolvedValue(
              profile({ stripe_connect_account_id: 'acct_live' }),
            ),
        }),
        makeStripe({ createExpressAccount, createAccountLink }),
        config,
      );

      await expect(svc.onboardingLink('u1')).rejects.toThrow('rate limited');
      expect(createExpressAccount).not.toHaveBeenCalled();
    });

    it('rejects a user with no consultant profile', async () => {
      const svc = new ConnectService(
        makeRepo({ getProfileByUserId: jest.fn().mockResolvedValue(null) }),
        makeStripe(),
        config,
      );
      await expect(svc.onboardingLink('u1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('syncAccountStatus', () => {
    it('maps the account and persists by account id', async () => {
      const syncKycByAccountId = jest.fn().mockResolvedValue(true);
      const svc = new ConnectService(
        makeRepo({ syncKycByAccountId }),
        makeStripe(),
        config,
      );
      await svc.syncAccountStatus({
        id: 'acct_1',
        details_submitted: true,
        payouts_enabled: true,
        capabilities: { transfers: 'active' },
      });
      expect(syncKycByAccountId).toHaveBeenCalledWith('acct_1', {
        kyc_status: 'verified',
        payouts_enabled: true,
      });
    });

    it('no-ops on an account object without an id', async () => {
      const syncKycByAccountId = jest.fn();
      const svc = new ConnectService(
        makeRepo({ syncKycByAccountId }),
        makeStripe(),
        config,
      );
      await svc.syncAccountStatus({ id: '' });
      expect(syncKycByAccountId).not.toHaveBeenCalled();
    });
  });
});

/**
 * CONN-001 — two concurrent onboarding requests each created a REAL Stripe
 * Connect account.
 *
 * `ensureAccount` checked a profile the caller had already loaded, then wrote
 * unconditionally. A double-clicked button, or a client retrying a timed-out
 * request, produced two live Stripe accounts for one consultant and the later
 * write silently overwrote the earlier — orphaning an account nothing in the
 * database references. The retry did not converge either: if the write failed
 * after the Stripe call succeeded, the id stayed null and the next attempt
 * created yet another account.
 *
 * The conditional write is now the claim, and the loser adopts the winner.
 */
describe('ConnectService — the Connect-account claim', () => {
  it("adopts the winner's account when it loses the race", async () => {
    const createExpressAccount = jest
      .fn()
      .mockResolvedValue({ id: 'acct_loser' });
    const createAccountLink = jest
      .fn()
      .mockResolvedValue({ url: 'https://connect.stripe/onboard' });
    const getProfileById = jest.fn().mockResolvedValue({
      ...profile(),
      stripe_connect_account_id: 'acct_winner',
    });

    const svc = new ConnectService(
      makeRepo({
        getProfileByUserId: jest.fn().mockResolvedValue(profile()),
        // Another request claimed the row first.
        setConnectAccountId: jest.fn().mockResolvedValue(false),
        getProfileById,
      }),
      makeStripe({ createExpressAccount, createAccountLink }),
      config,
    );

    await svc.onboardingLink('u1');

    expect(getProfileById).toHaveBeenCalledWith('c1');
    // The link is minted for the account that actually won the row, not the
    // one this request happened to create.
    expect(createAccountLink).toHaveBeenCalledWith(
      expect.objectContaining({ account: 'acct_winner' }),
    );
  });

  it('keeps its own account when it wins, without a re-read', async () => {
    const createExpressAccount = jest
      .fn()
      .mockResolvedValue({ id: 'acct_mine' });
    const createAccountLink = jest
      .fn()
      .mockResolvedValue({ url: 'https://connect.stripe/onboard' });
    const getProfileById = jest.fn();

    const svc = new ConnectService(
      makeRepo({
        getProfileByUserId: jest.fn().mockResolvedValue(profile()),
        setConnectAccountId: jest.fn().mockResolvedValue(true),
        getProfileById,
      }),
      makeStripe({ createExpressAccount, createAccountLink }),
      config,
    );

    await svc.onboardingLink('u1');

    expect(getProfileById).not.toHaveBeenCalled();
    expect(createAccountLink).toHaveBeenCalledWith(
      expect.objectContaining({ account: 'acct_mine' }),
    );
  });

  it('fails closed when it loses the claim and no winner can be read', async () => {
    const createExpressAccount = jest
      .fn()
      .mockResolvedValue({ id: 'acct_loser' });
    const createAccountLink = jest.fn();
    const svc = new ConnectService(
      makeRepo({
        getProfileByUserId: jest.fn().mockResolvedValue(profile()),
        setConnectAccountId: jest.fn().mockResolvedValue(false),
        getProfileById: jest.fn().mockResolvedValue(null),
      }),
      makeStripe({ createExpressAccount, createAccountLink }),
      config,
    );

    await expect(svc.onboardingLink('u1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(createAccountLink).not.toHaveBeenCalled();
  });
});
