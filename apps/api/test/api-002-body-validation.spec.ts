import { BadRequestException } from '@nestjs/common';
import { FinancialOpsController } from '../src/modules/financial-ops/financial-ops.controller';
import { PayoutsController } from '../src/modules/payouts/payouts.controller';
import { CouponAdminController } from '../src/modules/discounts/discounts.admin.controller';
import { ExecutionController } from '../src/modules/execution/execution.controller';
import { NarrativeController } from '../src/modules/narrative/narrative.controller';
import type { AuthUser } from '../src/modules/auth/jwt.guard';

/**
 * API-002: seventeen routes across twelve controllers declared a `@Body()` type
 * that TypeScript erases at runtime, so they accepted anything and failed
 * downstream — as a 500 from a service or database rather than a 400.
 *
 * These are the money and identity paths, where an unchecked number matters
 * most: a negative refund, a 900%-off coupon, a fractional cent.
 */

const user = { id: 'user-1' } as AuthUser;
const noop = () => {
  throw new Error('service must not be reached on invalid input');
};

/**
 * Most of these handlers are synchronous — they build a promise and return it,
 * so parseBody throws synchronously rather than rejecting. Wrapping normalises
 * both shapes so one assertion style covers async and sync handlers alike.
 */
const call = <T>(fn: () => T): Promise<Awaited<T>> =>
  (async () => fn())() as Promise<Awaited<T>>;

describe('API-002 — refund amounts (financial-ops)', () => {
  function make() {
    const refunds = {
      initiateRefund: jest.fn().mockResolvedValue({ id: 'r1' }),
    };
    return {
      ctrl: new FinancialOpsController(
        refunds as never,
        { listOpen: noop } as never,
        { revenue: noop } as never,
      ),
      refunds,
    };
  }

  it('accepts a positive integer amount', async () => {
    const { ctrl, refunds } = make();
    await ctrl.refund('pi_1', user, { amountCents: 500, reason: 'duplicate' });
    expect(refunds.initiateRefund).toHaveBeenCalledWith(
      'pi_1',
      'user-1',
      500,
      'duplicate',
    );
  });

  it('accepts an omitted amount (full refund)', async () => {
    const { ctrl, refunds } = make();
    await ctrl.refund('pi_1', user, {});
    expect(refunds.initiateRefund).toHaveBeenCalledWith(
      'pi_1',
      'user-1',
      undefined,
      undefined,
    );
  });

  it.each([
    ['a negative amount', { amountCents: -500 }],
    ['a zero amount', { amountCents: 0 }],
    ['a fractional cent', { amountCents: 10.5 }],
    ['a string amount', { amountCents: '500' }],
    ['a null body', null],
  ])('rejects %s without calling the refund service', async (_l, body) => {
    const { ctrl, refunds } = make();
    await expect(
      call(() => ctrl.refund('pi_1', user, body)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(refunds.initiateRefund).not.toHaveBeenCalled();
  });
});

describe('API-002 — coupon creation (discounts)', () => {
  function make() {
    const provider = {
      createCoupon: jest.fn().mockResolvedValue({ id: 'co_1' }),
    };
    const repo = { createCoupon: jest.fn().mockResolvedValue({ id: 'c1' }) };
    return {
      ctrl: new CouponAdminController(provider as never, repo as never),
      provider,
    };
  }

  it('accepts a well-formed percent coupon', async () => {
    const { ctrl, provider } = make();
    await ctrl.create({
      code: 'LAUNCH20',
      kind: 'percent',
      percentOff: 20,
      appliesTo: 'processing_fee',
    });
    expect(provider.createCoupon).toHaveBeenCalled();
  });

  it.each([
    [
      'over-100% discount',
      { code: 'X', kind: 'percent', percentOff: 900, appliesTo: 'any' },
    ],
    [
      'negative percent',
      { code: 'X', kind: 'percent', percentOff: -20, appliesTo: 'any' },
    ],
    [
      'a negative amount',
      { code: 'X', kind: 'amount', amountOffCents: -100, appliesTo: 'any' },
    ],
    [
      'an unknown appliesTo',
      { code: 'X', kind: 'percent', percentOff: 10, appliesTo: 'everything' },
    ],
    ['an unknown kind', { code: 'X', kind: 'freebie', appliesTo: 'any' }],
    ['a missing code', { kind: 'percent', percentOff: 10, appliesTo: 'any' }],
    // The cross-field rule: the discount value must match the declared kind.
    [
      'percent kind with no percentOff',
      { code: 'X', kind: 'percent', appliesTo: 'any' },
    ],
    [
      'amount kind with no amountOffCents',
      { code: 'X', kind: 'amount', appliesTo: 'any' },
    ],
  ])('rejects %s before it reaches Stripe', async (_l, body) => {
    const { ctrl, provider } = make();
    await expect(call(() => ctrl.create(body))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(provider.createCoupon).not.toHaveBeenCalled();
  });
});

describe('API-002 — tax profile (payouts)', () => {
  function make() {
    const tax = { upsertProfile: jest.fn().mockResolvedValue({ id: 'tp1' }) };
    return {
      ctrl: new PayoutsController(
        { onboardingLink: noop } as never,
        { earnings: noop } as never,
        tax as never,
      ),
      tax,
    };
  }

  it('accepts a valid W-9 profile and upper-cases the country', async () => {
    const { ctrl, tax } = make();
    await ctrl.upsertTaxProfile(user, {
      taxCountry: 'us',
      formType: 'w9',
      taxId: '12-3456789',
    });
    expect(tax.upsertProfile).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ taxCountry: 'US', formType: 'w9' }),
    );
  });

  it.each([
    ['an unknown form type', { taxCountry: 'US', formType: 'w7' }],
    ['a 3-letter country', { taxCountry: 'USA', formType: 'w9' }],
    ['a missing country', { formType: 'w9' }],
  ])('rejects %s', async (_l, body) => {
    const { ctrl, tax } = make();
    await expect(
      call(() => ctrl.upsertTaxProfile(user, body)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tax.upsertProfile).not.toHaveBeenCalled();
  });
});

describe('API-002 — execution and narrative', () => {
  it('execution rejects a non-uuid applicationId', async () => {
    const execution = { execute: jest.fn() };
    const ctrl = new ExecutionController(execution as never);
    await expect(
      call(() =>
        ctrl.execute({ applicationId: 'not-a-uuid', readbackToken: 't' }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(execution.execute).not.toHaveBeenCalled();
  });

  it('narrative rejects an unknown docType', async () => {
    const narrative = { generate: jest.fn(), approve: jest.fn() };
    const ctrl = new NarrativeController(narrative as never);
    // Signature order is (db, user, applicationId, body).
    await expect(
      call(() =>
        ctrl.generate({} as never, user, 'app-1', { docType: 'ransom_note' }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(narrative.generate).not.toHaveBeenCalled();
  });
});
