import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { PricingController } from './pricing.controller';
import type { PricingService } from './pricing.service';
import type { PricingAdminService } from './pricing-admin.service';
import type { Env } from '../../config/configuration';

function make(mode?: 'canada') {
  const pricing = {
    listPublicQuotes: jest.fn().mockResolvedValue([
      { visa_type: 'visitor', country_code: 'CA' },
      { visa_type: 'visitor', country_code: 'US' },
    ]),
    listCountries: jest
      .fn()
      .mockResolvedValue([{ country_code: 'CA' }, { country_code: 'GB' }]),
    getPublicQuote: jest.fn().mockResolvedValue({ price: 1 }),
  };
  const admin = { updateCountryFactor: jest.fn().mockResolvedValue(undefined) };
  const config = mode
    ? ({ get: () => mode } as unknown as ConfigService<Env>)
    : undefined;
  const controller = new PricingController(
    pricing as unknown as PricingService,
    admin as unknown as PricingAdminService,
    config,
  );
  return { controller, pricing, admin };
}

describe('PricingController — Canada site scope', () => {
  it('canada: quotes and countries are limited to CA', async () => {
    const { controller } = make('canada');
    expect((await controller.quotes()).map((q) => q.country_code)).toEqual([
      'CA',
    ]);
    expect((await controller.countries()).map((c) => c.country_code)).toEqual([
      'CA',
    ]);
  });

  it('global: quotes and countries are unfiltered', async () => {
    const { controller } = make();
    expect(await controller.quotes()).toHaveLength(2);
    expect(await controller.countries()).toHaveLength(2);
  });

  it('canada: refuses a quote or a factor edit for another country', () => {
    const { controller, pricing, admin } = make('canada');
    expect(() =>
      controller.quote({ visaType: 'visitor', country: 'US' }),
    ).toThrow(BadRequestException);
    expect(() =>
      controller.updateCountryFactor('US', { labor_multiplier: 1 }),
    ).toThrow(BadRequestException);
    expect(pricing.getPublicQuote).not.toHaveBeenCalled();
    expect(admin.updateCountryFactor).not.toHaveBeenCalled();
  });
});
