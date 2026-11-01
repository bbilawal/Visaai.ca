/**
 * In-memory stand-in for the three payment-webhook RPCs LedgerService calls
 * (supabase/migrations/20260906210000_payment_webhook_processing_state.sql).
 *
 * LedgerService moved from table inserts to these RPCs, and the money-path
 * e2e fakes were never given `rpc`, so every webhook spec failed with
 * "this.supabase.admin.rpc is not a function". This mirrors the SQL rather
 * than stubbing it, because the behaviour under test IS that SQL:
 *
 * - claim: insert the receipt (unique on provider_event_id, so a replay keeps
 *   the first one) and a `processing` row → 'claimed'. An existing row is
 *   re-claimed when `failed`, or `processing` for over ten minutes; otherwise
 *   its current status is returned ('processed' / 'processing').
 * - complete / fail: only a `processing` row may move; anything else raises.
 */
export interface PaymentWebhookTables {
  payment_events?: any[];
  payment_event_processing?: any[];
  [table: string]: any[] | undefined;
}

const STALE_LEASE_MS = 10 * 60 * 1000;

export function paymentWebhookRpc(
  tables: PaymentWebhookTables,
  now: () => Date = () => new Date(),
) {
  const events = (tables.payment_events ??= []);
  const processing = (tables.payment_event_processing ??= []);
  const row = (id: string) =>
    processing.find((r) => r.provider_event_id === id);
  const ok = (data: unknown = null) => Promise.resolve({ data, error: null });
  const fail = (message: string) =>
    Promise.resolve({ data: null, error: { message } });

  return (fn: string, args: Record<string, any>) => {
    switch (fn) {
      case 'claim_payment_webhook_event': {
        const id = args.p_provider_event_id;
        if (!events.some((e) => e.provider_event_id === id)) {
          events.push({
            provider: args.p_provider,
            event_type: args.p_event_type,
            provider_event_id: id,
            provider_object_id: args.p_provider_object_id,
            amount_minor: args.p_amount_minor,
            currency: args.p_currency,
            direction: args.p_direction,
            user_id: args.p_user_id,
            related_entity: args.p_related_entity ?? {},
            occurred_at: args.p_occurred_at,
          });
        }
        const existing = row(id);
        if (!existing) {
          processing.push({
            provider_event_id: id,
            status: 'processing',
            attempt_count: 1,
            claimed_at: now(),
            last_error: null,
          });
          return ok('claimed');
        }
        const stale =
          existing.status === 'processing' &&
          now().getTime() - existing.claimed_at.getTime() > STALE_LEASE_MS;
        if (existing.status === 'failed' || stale) {
          Object.assign(existing, {
            status: 'processing',
            attempt_count: existing.attempt_count + 1,
            claimed_at: now(),
            last_error: null,
          });
          return ok('claimed');
        }
        return ok(existing.status);
      }
      case 'complete_payment_webhook_event':
      case 'fail_payment_webhook_event': {
        const id = args.p_provider_event_id;
        const existing = row(id);
        if (!existing || existing.status !== 'processing') {
          return fail(`payment webhook ${id} is not processing`);
        }
        if (fn === 'complete_payment_webhook_event') {
          Object.assign(existing, {
            status: 'processed',
            processed_at: now(),
            last_error: null,
          });
        } else {
          Object.assign(existing, {
            status: 'failed',
            last_error: String(args.p_error ?? 'webhook handler failed').slice(
              0,
              1000,
            ),
          });
        }
        return ok();
      }
      default:
        return fail(`unexpected rpc ${fn}`);
    }
  };
}
