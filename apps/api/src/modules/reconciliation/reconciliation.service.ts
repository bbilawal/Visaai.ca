import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../shared/supabase/supabase.service';
import {
  PAYMENT_PROVIDER,
  type BalanceTxn,
  type DateRange,
  type PaymentProvider,
} from '../shared/payments/payment-provider.port';

export type ExceptionKind =
  | 'missing_in_ledger'
  | 'phantom_in_ledger'
  | 'amount_mismatch';

export interface ReconcileResult {
  runId: string;
  matched: number;
  exceptions: {
    kind: ExceptionKind;
    providerObjectId: string;
    expected: unknown;
    actual: unknown;
  }[];
}

/**
 * Daily reconciliation: match the append-only payment ledger against the
 * provider's balance transactions for a window, persist a run + any exceptions.
 * Exceptions are surfaced via structured logs and the queryable
 * reconciliation_exceptions table (admin dashboard, SP6). Ops alerting (email/
 * pager) is intentionally deferred to SP5 — the user-facing NotificationEventBus
 * is the wrong channel for an operational finance signal.
 */
@Injectable()
export class ReconciliationService {
  private readonly log = new Logger(ReconciliationService.name);

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly supabase: SupabaseService,
  ) {}

  async reconcile(range: DateRange): Promise<ReconcileResult> {
    // 1. Pull all provider balance transactions in range (paginated).
    const txns: BalanceTxn[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.provider.listBalanceTransactions(range, cursor);
      txns.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    // 2. Load ledger events in range.
    const { data: ledgerRows, error } = await this.supabase.admin
      .from('payment_events')
      .select('provider_object_id, amount_minor, currency')
      .gte('occurred_at', range.start.toISOString())
      .lt('occurred_at', range.end.toISOString());
    if (error) {
      throw new Error(
        (error as { message?: string }).message ?? 'ledger read failed',
      );
    }

    const ledgerByObj = new Map<
      string,
      { amount_minor: number | null; currency: string | null }
    >();
    for (const r of ledgerRows ?? []) ledgerByObj.set(r.provider_object_id, r);
    const txnByObj = new Map<string, BalanceTxn>();
    for (const t of txns) txnByObj.set(t.providerObjectId, t);

    // 3. Open the run row.
    const { data: run } = await this.supabase.admin
      .from('reconciliation_runs')
      .insert({
        run_date: range.start.toISOString().slice(0, 10),
        range_start: range.start.toISOString(),
        range_end: range.end.toISOString(),
        provider: this.provider.name,
        status: 'running',
      })
      .select('id')
      .single();
    const runId = run!.id;

    // 4. Compare.
    const exceptions: ReconcileResult['exceptions'] = [];
    let matched = 0;

    for (const t of txns) {
      const l = ledgerByObj.get(t.providerObjectId);
      if (!l) {
        exceptions.push({
          kind: 'missing_in_ledger',
          providerObjectId: t.providerObjectId,
          expected: null,
          actual: {
            amount_minor: t.amount.amountMinor,
            currency: t.amount.currency,
          },
        });
      } else if (
        l.amount_minor !== t.amount.amountMinor ||
        l.currency !== t.amount.currency
      ) {
        exceptions.push({
          kind: 'amount_mismatch',
          providerObjectId: t.providerObjectId,
          expected: l,
          actual: {
            amount_minor: t.amount.amountMinor,
            currency: t.amount.currency,
          },
        });
      } else {
        matched += 1;
      }
    }
    for (const r of ledgerRows ?? []) {
      if (!txnByObj.has(r.provider_object_id)) {
        exceptions.push({
          kind: 'phantom_in_ledger',
          providerObjectId: r.provider_object_id,
          expected: { amount_minor: r.amount_minor, currency: r.currency },
          actual: null,
        });
      }
    }

    // 5. Persist exceptions + close the run.
    if (exceptions.length) {
      await this.supabase.admin.from('reconciliation_exceptions').insert(
        exceptions.map((e) => ({
          run_id: runId,
          kind: e.kind,
          provider_object_id: e.providerObjectId,
          expected: e.expected,
          actual: e.actual,
        })),
      );
    }
    await this.supabase.admin
      .from('reconciliation_runs')
      .update({
        status: 'completed',
        matched_count: matched,
        exception_count: exceptions.length,
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId);

    if (exceptions.length) {
      this.log.warn(
        `reconciliation run ${runId}: ${exceptions.length} exception(s)`,
      );
    }

    return { runId, matched, exceptions };
  }
}
