import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/configuration';
import { PAYMENT_PROVIDER } from './payment-provider.port';
import { PaymentWebhookService } from './payment-webhook.service';
import { stripeClientProvider, STRIPE_CLIENT } from './stripe/stripe.factory';
import { StripePaymentProvider } from './stripe/stripe-payment.provider';

/**
 * @Global payment foundation. Binds PAYMENT_PROVIDER to the configured provider
 * adapter so any module can inject the port without importing this module.
 * Stripe is the only implementation today; PAYMENT_PROVIDER_NAME selects it.
 */
@Global()
@Module({
  providers: [
    stripeClientProvider,
    StripePaymentProvider,
    PaymentWebhookService,
    {
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService, StripePaymentProvider],
      useFactory: (
        config: ConfigService<Env>,
        stripe: StripePaymentProvider,
      ) => {
        const name =
          config.get('PAYMENT_PROVIDER_NAME', { infer: true }) ?? 'stripe';
        switch (name) {
          case 'stripe':
            return stripe;
          default:
            throw new Error(`Unsupported PAYMENT_PROVIDER_NAME: ${name}`);
        }
      },
    },
  ],
  exports: [PAYMENT_PROVIDER, STRIPE_CLIENT, PaymentWebhookService],
})
export class PaymentsModule {}
