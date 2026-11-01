import type { Money } from './money';

/**
 * ARCH-003: `shared/payments` imported `ledger` directly (both the module and
 * the service), which was one of the two back-edges turning `shared` — the base
 * layer 43 modules depend on — into part of a six-module cycle.
 *
 * This mirrors the `PAYMENT_PROVIDER` port already used in this module: the
 * consumer declares the shape, the implementer binds it.
 *
 * The contract is a durable processing claim. A provider retry must be skipped
 * only after side effects have completed; marking an event seen before dispatch
 * loses a payment when the handler transiently fails.
 */
export interface PaymentEventRecord {
  provider: string;
  eventType: string;
  /** Provider-side unique id. The idempotency key. */
  providerEventId: string;
  providerObjectId: string;
  amount: Money | null;
  direction: 'credit' | 'debit';
  userId?: string | null;
  relatedEntity?: Record<string, unknown>;
  occurredAt: Date;
}

export interface PaymentEventRecorder {
  /** Atomically persist the ledger event and acquire its processing lease. */
  claim(
    input: PaymentEventRecord,
  ): Promise<'claimed' | 'processed' | 'processing'>;
  /** Called only after all domain side effects have succeeded. */
  markProcessed(providerEventId: string): Promise<void>;
  /** Releases a failed attempt so the provider's retry can safely claim it. */
  markFailed(providerEventId: string, error: string): Promise<void>;
}

export const PAYMENT_EVENT_RECORDER = Symbol('PAYMENT_EVENT_RECORDER');
