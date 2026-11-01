import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PaymentsModule } from './payments.module';
import { PAYMENT_PROVIDER } from './payment-provider.port';
import type { PaymentProvider } from './payment-provider.port';
import { SupabaseService } from '../supabase/supabase.service';
// ARCH-003: PaymentsModule no longer imports LedgerModule — it consumes the
// PAYMENT_EVENT_RECORDER port instead. LedgerModule is @Global and binds it, so
// the composition must include it, exactly as app.module does.
import { LedgerModule } from '../../ledger/ledger.module';

// SupabaseService is @Global in the running app (SupabaseModule). LedgerService
// depends on it, so the test supplies a global stub.
@Global()
@Module({
  providers: [{ provide: SupabaseService, useValue: {} }],
  exports: [SupabaseService],
})
class FakeSupabaseModule {}

describe('PaymentsModule', () => {
  it('resolves PAYMENT_PROVIDER to a provider named "stripe"', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              STRIPE_SECRET_KEY: 'sk_test_x',
              STRIPE_WEBHOOK_SECRET: 'whsec_x',
              PAYMENT_PROVIDER_NAME: 'stripe',
            }),
          ],
        }),
        FakeSupabaseModule,
        LedgerModule,
        PaymentsModule,
      ],
    }).compile();

    const provider = moduleRef.get<PaymentProvider>(PAYMENT_PROVIDER);
    expect(provider.name).toBe('stripe');
  });
});
