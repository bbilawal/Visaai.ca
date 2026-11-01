import { Injectable } from '@nestjs/common';
import type { ConsultantPayout } from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { pageRows } from '../shared/supabase/page-rows';
import type { EarningsRaw, SweepableOrder } from './payouts.engine';
import type {
  IPayoutsRepository,
  PayoutProfile,
  PayoutItemRow,
  PayoutRow,
  RecordPayoutInput,
  TaxProfileRow,
  TaxStatementRow,
} from './payouts.repository';

const PROFILE_COLS =
  'id, user_id, license_country, stripe_connect_account_id, kyc_status, payouts_enabled, users(email)';

/** PostgREST returns embeds as array (to-many) or object (to-one) — normalize. */
function one<T>(embed: unknown): T | null {
  if (Array.isArray(embed)) return (embed[0] as T) ?? null;
  return (embed as T) ?? null;
}

function toProfile(r: Record<string, unknown>): PayoutProfile {
  const user = one<{ email: string | null }>(r.users);
  return {
    id: String(r.id),
    user_id: String(r.user_id),
    email: user?.email ?? null,
    country: (r.license_country as string | null) ?? null,
    stripe_connect_account_id:
      (r.stripe_connect_account_id as string | null) ?? null,
    kyc_status: r.kyc_status as PayoutProfile['kyc_status'],
    payouts_enabled: Boolean(r.payouts_enabled),
  };
}

/**
 * Payout/Connect persistence. All order + payout writes are service-role only
 * (RLS blocks user/consultant writes — see migration §8); the service authorizes
 * the caller before any read of their own profile/earnings.
 */
@Injectable()
export class PayoutsRepository implements IPayoutsRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async getProfileByUserId(userId: string): Promise<PayoutProfile | null> {
    const { data, error } = await this.supabase.admin
      .from('consultant_profiles')
      .select(PROFILE_COLS)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data ? toProfile(data) : null;
  }

  async getProfileById(profileId: string): Promise<PayoutProfile | null> {
    const { data, error } = await this.supabase.admin
      .from('consultant_profiles')
      .select(PROFILE_COLS)
      .eq('id', profileId)
      .maybeSingle();
    if (error) throw error;
    return data ? toProfile(data) : null;
  }

  async setConnectAccountId(
    profileId: string,
    accountId: string,
    opts: { onlyIfUnset?: boolean } = {},
  ): Promise<boolean> {
    let q = this.supabase.admin
      .from('consultant_profiles')
      .update({
        stripe_connect_account_id: accountId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', profileId);
    // The conditional turns this row into the mutual exclusion for account
    // creation. Without it, two concurrent writes both "succeed" and the loser's
    // Stripe account is orphaned with nothing referencing it.
    if (opts.onlyIfUnset) q = q.is('stripe_connect_account_id', null);
    const { data, error } = await q.select('id');
    if (error) throw error;
    return (data ?? []).length > 0;
  }

  async syncKycByAccountId(
    accountId: string,
    patch: {
      kyc_status: PayoutProfile['kyc_status'];
      payouts_enabled: boolean;
    },
  ): Promise<boolean> {
    const { data, error } = await this.supabase.admin
      .from('consultant_profiles')
      .update({
        kyc_status: patch.kyc_status,
        payouts_enabled: patch.payouts_enabled,
        updated_at: new Date().toISOString(),
      })
      .eq('stripe_connect_account_id', accountId)
      .select('id');
    if (error) throw error;
    return (data ?? []).length > 0;
  }

  async listSweepableOrders(): Promise<SweepableOrder[]> {
    // PAY-001: both reads are paged.
    //
    // PostgREST silently truncates an unbounded select at PGRST_DB_MAX_ROWS
    // (1000 on the self-hosted stack), and both halves of this method were
    // unbounded. Each truncation is its own defect, in opposite directions:
    //
    //   orders  — past 1000 paid orders, the tail is never returned and those
    //             consultants are simply never paid, indefinitely and silently.
    //
    //   items   — this is the "already swept" EXCLUSION set. Truncated, it
    //             omits real entries, so orders that were already paid re-enter
    //             the sweep. Stripe's per-order idempotency key
    //             (`payout_item_<order id>`, see PayoutsService.sweep) returns
    //             the existing transfer instead of making a new one, so this is
    //             not an instant double payment — but Stripe retains those keys
    //             for about 24 hours. Once the exclusion set is truncated, the
    //             omitted orders are effectively arbitrary and keep reappearing
    //             long past that window, at which point a second transfer IS
    //             created. The insert of the duplicate payout item then fails on
    //             the UNIQUE constraint, after the money has moved.
    //
    // Ordered by id: `.range()` paging is only stable with a deterministic sort,
    // and both tables are written while this runs.
    const orders = await pageRows<Record<string, unknown>>(
      () =>
        this.supabase.admin
          .from('consultant_service_orders')
          .select(
            'id, consultant_id, consultant_payout_usd, amount_usd, currency, stripe_payment_intent_id, consultant_profiles(stripe_connect_account_id, payouts_enabled)',
          )
          .eq('status', 'paid')
          .order('id', { ascending: true }) as never,
    );

    // Orders already swept have a payout_item (service_order_id is UNIQUE there).
    const items = await pageRows<{ service_order_id: string }>(
      () =>
        this.supabase.admin
          .from('consultant_payout_items')
          .select('service_order_id')
          .order('service_order_id', { ascending: true }) as never,
    );
    const swept = new Set(items.map((i) => String(i.service_order_id)));

    return orders
      .map((o) => {
        const r = o;
        const profile = one<{
          stripe_connect_account_id: string | null;
          payouts_enabled: boolean;
        }>(r.consultant_profiles);
        return {
          service_order_id: String(r.id),
          consultant_id: String(r.consultant_id),
          consultant_payout_usd: Number(r.consultant_payout_usd ?? 0),
          amount_usd: Number(r.amount_usd ?? 0),
          currency: (r.currency as string | null) ?? 'usd',
          stripe_connect_account_id: profile?.stripe_connect_account_id ?? null,
          payouts_enabled: Boolean(profile?.payouts_enabled),
          stripe_payment_intent_id:
            (r.stripe_payment_intent_id as string | null) ?? null,
        };
      })
      .filter((o) => !swept.has(o.service_order_id));
  }

  async recordPayout(input: RecordPayoutInput): Promise<ConsultantPayout> {
    const { data: payout, error } = await this.supabase.admin
      .from('consultant_payouts')
      .insert({
        consultant_id: input.consultant_id,
        amount_usd: input.amount_usd,
        currency: input.currency,
        status: input.status,
        stripe_transfer_id: input.stripe_transfer_id,
        period_start: input.period_start,
        period_end: input.period_end,
        payout_date:
          input.status === 'failed' ? null : new Date().toISOString(),
        note: input.note ?? null,
      })
      .select(
        'id, consultant_id, amount_usd, currency, status, stripe_transfer_id, period_start, period_end, payout_date, note, created_at',
      )
      .single();
    if (error) throw error;
    const payoutId = String(payout.id);

    if (input.items.length > 0) {
      const { error: iErr } = await this.supabase.admin
        .from('consultant_payout_items')
        .insert(
          input.items.map((it) => ({
            payout_id: payoutId,
            service_order_id: it.service_order_id,
            amount_usd: it.amount_usd,
            stripe_transfer_id: it.stripe_transfer_id ?? null,
          })),
        );
      if (iErr) throw iErr;
    }

    return {
      id: payoutId,
      consultant_id: String(payout.consultant_id),
      amount_usd: Number(payout.amount_usd),
      currency: String(payout.currency),
      status: payout.status as ConsultantPayout['status'],
      stripe_transfer_id: payout.stripe_transfer_id ?? null,
      period_start: payout.period_start ?? null,
      period_end: payout.period_end ?? null,
      payout_date: payout.payout_date ?? null,
      note: payout.note ?? null,
      created_at: String(payout.created_at),
    };
  }

  async getEarnings(consultantId: string): Promise<EarningsRaw> {
    const { data: paidOrders, error } = await this.supabase.admin
      .from('consultant_service_orders')
      .select('consultant_payout_usd')
      .eq('consultant_id', consultantId)
      .eq('status', 'paid');
    if (error) throw error;

    const lifetime_usd = (paidOrders ?? []).reduce(
      (sum, o) => sum + Number(o.consultant_payout_usd ?? 0),
      0,
    );

    // paid_out = funds actually transferred (exclude failed/reversed).
    const { data: payouts, error: pErr } = await this.supabase.admin
      .from('consultant_payouts')
      .select('amount_usd')
      .eq('consultant_id', consultantId)
      .in('status', ['in_transit', 'paid']);
    if (pErr) throw pErr;

    const paid_out_usd = (payouts ?? []).reduce(
      (sum, p) => sum + Number(p.amount_usd ?? 0),
      0,
    );

    return {
      lifetime_usd,
      paid_out_usd,
      orders_count: (paidOrders ?? []).length,
    };
  }

  async listPayoutsByConsultant(
    consultantId: string,
  ): Promise<{ payouts: PayoutRow[]; items: PayoutItemRow[] }> {
    const { data: payouts } = await this.supabase.admin
      .from('consultant_payouts')
      .select(
        'id, consultant_id, amount_usd, currency, status, period_end, stripe_transfer_id, created_at',
      )
      .eq('consultant_id', consultantId)
      .order('created_at', { ascending: false });
    const ids = (payouts ?? []).map((p) => p.id);
    const { data: items } = ids.length
      ? await this.supabase.admin
          .from('consultant_payout_items')
          .select('payout_id, service_order_id, amount_usd, stripe_transfer_id')
          .in('payout_id', ids)
      : { data: [] as PayoutItemRow[] };
    return {
      payouts: payouts ?? [],
      items: items ?? [],
    };
  }

  async markPayoutReversed(
    transferId: string,
  ): Promise<{ reversed: boolean; consultantId: string | null }> {
    // Legacy shape: one grouped transfer recorded on the payout itself.
    const { data } = await this.supabase.admin
      .from('consultant_payouts')
      .update({ status: 'reversed' })
      .eq('stripe_transfer_id', transferId)
      .select('id, consultant_id')
      .maybeSingle();
    if (data) {
      // Clear item links so the underlying orders return to the sweepable set.
      await this.supabase.admin
        .from('consultant_payout_items')
        .delete()
        .eq('payout_id', data.id);
      return { reversed: true, consultantId: data.consultant_id };
    }

    // Current shape: transfers are per item. Reverse ONLY the order that
    // transfer paid — the rest of the payout stands.
    const { data: item } = await this.supabase.admin
      .from('consultant_payout_items')
      .select('id, payout_id')
      .eq('stripe_transfer_id', transferId)
      .maybeSingle();
    if (!item) return { reversed: false, consultantId: null };

    const payoutId = String(item.payout_id);
    const { data: payout } = await this.supabase.admin
      .from('consultant_payouts')
      .select('consultant_id')
      .eq('id', payoutId)
      .maybeSingle();

    // Dropping the link is what returns the order to the sweepable set.
    await this.supabase.admin
      .from('consultant_payout_items')
      .delete()
      .eq('id', item.id);

    // Re-derive the payout total from what survives, and mark it reversed only
    // once nothing is left — a partial reversal must not zero the whole row.
    const { data: remaining } = await this.supabase.admin
      .from('consultant_payout_items')
      .select('amount_usd')
      .eq('payout_id', payoutId);
    const rows = remaining ?? [];
    const total =
      Math.round(
        rows.reduce((sum, r) => sum + Number(r.amount_usd ?? 0), 0) * 100,
      ) / 100;
    await this.supabase.admin
      .from('consultant_payouts')
      .update({
        amount_usd: total,
        ...(rows.length === 0 ? { status: 'reversed' } : {}),
      })
      .eq('id', payoutId);

    return {
      reversed: true,
      consultantId: payout?.consultant_id ? String(payout.consultant_id) : null,
    };
  }

  async upsertTaxProfile(input: {
    consultantId: string;
    taxCountry: string;
    formType: 'w9' | 'w8';
    taxIdEncrypted: string | null;
    businessName: string | null;
    status: 'pending' | 'submitted';
  }): Promise<void> {
    const { error } = await this.supabase.admin
      .from('consultant_tax_profiles')
      .upsert(
        {
          consultant_id: input.consultantId,
          tax_country: input.taxCountry,
          form_type: input.formType,
          tax_id_encrypted: input.taxIdEncrypted,
          business_name: input.businessName,
          status: input.status,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'consultant_id' },
      );
    if (error) {
      throw new Error(
        (error as { message?: string }).message ?? 'tax profile upsert failed',
      );
    }
  }

  async getTaxProfile(consultantId: string): Promise<TaxProfileRow | null> {
    const { data } = await this.supabase.admin
      .from('consultant_tax_profiles')
      .select(
        'consultant_id, tax_country, form_type, tax_id_encrypted, business_name, status',
      )
      .eq('consultant_id', consultantId)
      .maybeSingle();
    return data ?? null;
  }

  async sumPaidForYear(
    consultantId: string,
    year: number,
  ): Promise<{
    grossPaidCents: number;
    payoutCount: number;
    currency: string;
  }> {
    // TAX-001: a failed read must not become a $0 tax statement.
    //
    // `error` was dropped here, so a transient failure produced `data = null`,
    // `rows = []`, and a confidently-generated annual statement reporting ZERO
    // income for a consultant who was paid all year. That statement is then
    // upserted and handed to them as a tax document. Throwing makes the
    // generation fail loudly and retry instead of publishing a false figure.
    //
    // Paged for the same reason as the sweep: an unbounded select stops at
    // PGRST_DB_MAX_ROWS, which would silently under-report a busy consultant's
    // year — the same direction of error, just quieter.
    const rows = await pageRows<{ amount_usd: number; currency: string }>(
      () =>
        this.supabase.admin
          .from('consultant_payouts')
          .select('id, amount_usd, currency')
          .eq('consultant_id', consultantId)
          .eq('status', 'paid')
          .gte('period_end', `${year}-01-01`)
          .lt('period_end', `${year + 1}-01-01`)
          .order('id', { ascending: true }) as never,
    );
    const grossPaidCents = rows.reduce(
      (s, r) => s + Math.round(Number(r.amount_usd) * 100),
      0,
    );
    return {
      grossPaidCents,
      payoutCount: rows.length,
      currency: rows[0]?.currency ?? 'usd',
    };
  }

  async upsertTaxStatement(input: {
    consultantId: string;
    taxYear: number;
    currency: string;
    grossPaidCents: number;
    payoutCount: number;
  }): Promise<TaxStatementRow> {
    const { data, error } = await this.supabase.admin
      .from('payout_tax_statements')
      .upsert(
        {
          consultant_id: input.consultantId,
          tax_year: input.taxYear,
          currency: input.currency,
          gross_paid_cents: input.grossPaidCents,
          payout_count: input.payoutCount,
          generated_at: new Date().toISOString(),
        },
        { onConflict: 'consultant_id,tax_year' },
      )
      .select(
        'consultant_id, tax_year, currency, gross_paid_cents, payout_count, generated_at',
      )
      .single();
    if (error) {
      throw new Error(
        (error as { message?: string }).message ?? 'statement upsert failed',
      );
    }
    return data;
  }

  async listConsultantsWithPaidPayouts(year: number): Promise<string[]> {
    const { data } = await this.supabase.admin
      .from('consultant_payouts')
      .select('consultant_id')
      .eq('status', 'paid')
      .gte('period_end', `${year}-01-01`)
      .lt('period_end', `${year + 1}-01-01`);
    return [...new Set((data ?? []).map((r) => String(r.consultant_id)))];
  }
}
