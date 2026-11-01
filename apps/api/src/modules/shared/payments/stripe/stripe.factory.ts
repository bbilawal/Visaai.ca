import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { Env } from '../../../../config/configuration';

export const STRIPE_CLIENT = Symbol('STRIPE_CLIENT');

/**
 * The single Stripe SDK construction site in the codebase. All payment
 * operations flow through the StripePaymentProvider adapter, which injects
 * this client — no other module may `new Stripe(...)`.
 */
export const stripeClientProvider = {
  provide: STRIPE_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env>): InstanceType<typeof Stripe> =>
    new Stripe(config.getOrThrow('STRIPE_SECRET_KEY', { infer: true })),
};
