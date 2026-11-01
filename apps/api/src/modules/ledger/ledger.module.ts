import { Global, Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { PAYMENT_EVENT_RECORDER } from '../shared/payments/payment-event-recorder.port';

/**
 * ARCH-003: @Global so PaymentsModule can consume PAYMENT_EVENT_RECORDER
 * without importing this module. That removes the shared -> ledger back-edge
 * which, together with shared -> analytics, made `shared` part of a six-module
 * cycle. Mirrors AnalyticsModule / SupabaseModule / AuthModule, which are
 * already @Global for the same reason.
 */
@Global()
@Module({
  providers: [
    LedgerService,
    { provide: PAYMENT_EVENT_RECORDER, useExisting: LedgerService },
  ],
  exports: [LedgerService, PAYMENT_EVENT_RECORDER],
})
export class LedgerModule {}
