import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConsultantEarnings, ConsultantKycStatus } from '@visaai/types';
import type { Env } from '../../config/configuration';
import {
  computeEarnings,
  groupSweepable,
  roundCents,
  settlementTransfer,
} from './payouts.engine';
import {
  PAYOUTS_REPOSITORY,
  type IPayoutsRepository,
  type PayoutItemInput,
} from './payouts.repository';
import { PAYOUTS_STRIPE, type IPayoutsStripe } from './payouts.stripe';

export interface SweepSummary {
  consultants: number;
  orders_swept: number;
  transferred_usd: number;
  failed: number;
}

/**
 * Marketplace pay-out engine (PAY-5/PAY-6). Sweeps paid+unswept service orders
 * into one Stripe transfer per consultant, recording the payout ledger. Earnings
 * are read straight from that ledger. Money math is server-side only.
 * See VISAAIDocs/features/consultant-marketplace/STRIPE-CONNECT.md §4/§6.
 */
@Injectable()
export class PayoutsService {
  private readonly log = new Logger(PayoutsService.name);

  constructor(
    @Inject(PAYOUTS_REPOSITORY) private readonly repo: IPayoutsRepository,
    @Inject(PAYOUTS_STRIPE) private readonly stripe: IPayoutsStripe,
    private readonly config: ConfigService<Env>,
  ) {}

  /**
   * Batch sweep. For each consultant with payouts enabled and unswept paid
   * orders, create a single transfer and persist the payout + its items.
   * Idempotency: the per-consultant+date transfer idempotencyKey blocks a
   * duplicate Stripe transfer, and consultant_payout_items.service_order_id is
   * UNIQUE so an order is linked at most once. A transfer failure records a
   * `failed` payout (no items) so the orders are retried on the next sweep.
   */
  async sweep(): Promise<SweepSummary> {
    const sweepable = await this.repo.listSweepableOrders();
    const groups = groupSweepable(sweepable);
    const period = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const minCents =
      this.config.get('MIN_PAYOUT_CENTS', { infer: true }) ?? 1000;

    const summary: SweepSummary = {
      consultants: 0,
      orders_swept: 0,
      transferred_usd: 0,
      failed: 0,
    };

    for (const g of groups) {
      const amountCents = Math.round(g.total_usd * 100);
      if (amountCents <= 0) continue;
      if (amountCents < minCents) {
        this.log.log(
          `skip ${g.consultant_id}: ${amountCents}c < min ${minCents}c (rolls over)`,
        );
        continue;
      }

      // One transfer PER ORDER. `source_transaction` keys a transfer to a single
      // charge, so a grouped transfer cannot carry it — and without it a transfer
      // can only spend *settled* balance, which strands payouts on a platform
      // holding no float. The payout row below remains the grouping/reporting
      // unit; the individual transfer ids live on its items.
      const paidItems: PayoutItemInput[] = [];
      const failures: string[] = [];

      for (const o of g.orders) {
        const itemCents = Math.round((o.consultant_payout_usd || 0) * 100);
        if (itemCents <= 0) continue;
        try {
          const funding = o.stripe_payment_intent_id
            ? await this.stripe.resolveChargeFunding(o.stripe_payment_intent_id)
            : null;
          // The ledger owes USD, but a source_transaction transfer must be
          // denominated in the currency the charge SETTLED into. Converting by
          // share of the settled gross uses Stripe's own rate for this charge,
          // so the consultant receives the equivalent of what they are owed
          // regardless of their country or bank currency.
          const move = settlementTransfer(o, o.amount_usd, funding);
          const transfer = await this.stripe.createTransfer({
            amountCents: move.amountMinor,
            currency: move.currency,
            destination: g.connect_account_id,
            // Per-order key: a retry after a crash returns Stripe's existing
            // transfer rather than paying the same order twice.
            idempotencyKey: `payout_item_${o.service_order_id}`,
            metadata: {
              consultant_id: g.consultant_id,
              service_order_id: o.service_order_id,
              period,
            },
            sourceTransaction: funding?.chargeId,
          });
          paidItems.push({
            service_order_id: o.service_order_id,
            amount_usd: o.consultant_payout_usd,
            stripe_transfer_id: transfer.id,
          });
        } catch (err) {
          failures.push(`${o.service_order_id}: ${(err as Error).message}`);
        }
      }

      if (paidItems.length === 0) {
        summary.failed += 1;
        this.log.error(
          `transfer failed for consultant ${g.consultant_id} (${g.total_usd} ${g.currency}): ${failures.join('; ')}`,
        );
        // Record the failure WITHOUT items so the orders stay unswept + retry.
        await this.repo
          .recordPayout({
            consultant_id: g.consultant_id,
            amount_usd: g.total_usd,
            currency: g.currency,
            status: 'failed',
            stripe_transfer_id: null,
            period_start: null,
            period_end: period,
            note: failures.join('; ').slice(0, 480) || 'transfer failed',
            items: [],
          })
          .catch((e) =>
            this.log.error(
              `could not record failed payout for ${g.consultant_id}: ${(e as Error).message}`,
            ),
          );
        continue;
      }

      if (failures.length > 0) {
        // Partial sweep: the orders that failed keep no payout_item, so the next
        // sweep retries exactly those.
        summary.failed += 1;
        this.log.error(
          `partial sweep for consultant ${g.consultant_id}: ${failures.length} order(s) stay unswept — ${failures.join('; ')}`,
        );
      }

      const paidUsd = roundCents(
        paidItems.reduce((sum, it) => sum + it.amount_usd, 0),
      );
      try {
        await this.repo.recordPayout({
          consultant_id: g.consultant_id,
          amount_usd: paidUsd,
          currency: g.currency,
          // Transfers are per item now; the payout row groups them.
          stripe_transfer_id: null,
          status: 'paid',
          period_start: null,
          period_end: period,
          items: paidItems,
        });
        summary.consultants += 1;
        summary.orders_swept += paidItems.length;
        summary.transferred_usd = roundCents(summary.transferred_usd + paidUsd);
      } catch (err) {
        // Money already moved. The ledger write failing is not a double-spend
        // risk — the per-order idempotency keys make the next sweep return the
        // same transfers — but it must be loud.
        summary.failed += 1;
        this.log.error(
          `transfers succeeded but ledger write failed for ${g.consultant_id} (${paidItems.map((i) => i.stripe_transfer_id).join(',')}): ${(err as Error).message}`,
        );
      }
    }

    this.log.log(
      `sweep: ${summary.orders_swept} orders / ${summary.consultants} consultants / $${summary.transferred_usd} / ${summary.failed} failed`,
    );
    return summary;
  }

  /** PAY-6: earnings for the calling user's consultant profile. */
  async earnings(userId: string): Promise<ConsultantEarnings> {
    const profile = await this.repo.getProfileByUserId(userId);
    if (!profile) {
      throw new ForbiddenException('No consultant profile for this account');
    }
    const raw = await this.repo.getEarnings(profile.id);
    return computeEarnings(profile.id, raw);
  }

  /**
   * SP4: record a Stripe transfer reversal. Marks the payout `reversed` and clears
   * its item links so the underlying orders return to the sweepable set (re-swept
   * next run). Idempotent: a missing/already-reversed payout is a no-op.
   */
  async handleTransferReversed(transferId: string): Promise<void> {
    const { reversed, consultantId } =
      await this.repo.markPayoutReversed(transferId);
    if (reversed) {
      this.log.warn(
        `transfer ${transferId} reversed for consultant ${consultantId}; orders re-queued`,
      );
    }
  }

  /**
   * Onboarding state for the calling consultant, so the UI can distinguish
   * "never started" from "submitted, awaiting Stripe" from "payable" without
   * inferring it from an empty earnings response.
   */
  async status(userId: string): Promise<{
    kyc_status: ConsultantKycStatus;
    payouts_enabled: boolean;
    onboarded: boolean;
  }> {
    const profile = await this.repo.getProfileByUserId(userId);
    if (!profile) {
      throw new ForbiddenException('No consultant profile for this account');
    }
    return {
      kyc_status: profile.kyc_status,
      payouts_enabled: profile.payouts_enabled,
      onboarded: Boolean(profile.stripe_connect_account_id),
    };
  }

  /** PAY-6: payout ledger + items for the calling consultant. */
  async history(
    userId: string,
  ): Promise<{ payouts: unknown[]; items: unknown[] }> {
    const profile = await this.repo.getProfileByUserId(userId);
    if (!profile) throw new NotFoundException('No consultant profile');
    return this.repo.listPayoutsByConsultant(profile.id);
  }

  /** Short-lived Stripe Express dashboard link (payout schedule + official 1099s). */
  async dashboardLink(userId: string): Promise<{ url: string }> {
    const profile = await this.repo.getProfileByUserId(userId);
    if (!profile?.stripe_connect_account_id) {
      throw new BadRequestException('Complete payout onboarding first');
    }
    return this.stripe.createExpressDashboardLink(
      profile.stripe_connect_account_id,
    );
  }
}
