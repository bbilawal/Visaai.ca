import type { ConsultantKycStatus, ConsultantPayout } from '@visaai/types';
import type { EarningsRaw, SweepableOrder } from './payouts.engine';

export const PAYOUTS_REPOSITORY = Symbol('PAYOUTS_REPOSITORY');

/** Consultant profile fields the payout/Connect flows need. */
export interface PayoutProfile {
  id: string;
  user_id: string;
  email: string | null;
  /** ISO-2 country for the Express account (license_country fallback). */
  country: string | null;
  stripe_connect_account_id: string | null;
  kyc_status: ConsultantKycStatus;
  payouts_enabled: boolean;
}

/** One swept order row recorded against a payout. */
export interface PayoutItemInput {
  service_order_id: string;
  amount_usd: number;
  /** The per-order Stripe transfer this item was paid by, when one succeeded. */
  stripe_transfer_id?: string | null;
}

export interface RecordPayoutInput {
  consultant_id: string;
  amount_usd: number;
  currency: string;
  status: 'in_transit' | 'paid' | 'failed';
  stripe_transfer_id: string | null;
  period_start: string | null;
  period_end: string | null;
  note?: string | null;
  items: PayoutItemInput[];
}

// --- SP4: payout history, reversal, tax profile + statements ---
export interface PayoutRow {
  id: string;
  consultant_id: string;
  amount_usd: number;
  currency: string;
  status: string;
  period_end: string | null;
  stripe_transfer_id: string | null;
  created_at: string;
}
export interface PayoutItemRow {
  payout_id: string;
  service_order_id: string;
  amount_usd: number;
  stripe_transfer_id?: string | null;
}
export interface TaxProfileRow {
  consultant_id: string;
  tax_country: string;
  form_type: 'w9' | 'w8';
  tax_id_encrypted: string | null;
  business_name: string | null;
  status: 'pending' | 'submitted';
}
export interface TaxStatementRow {
  consultant_id: string;
  tax_year: number;
  currency: string;
  gross_paid_cents: number;
  payout_count: number;
  generated_at: string;
}

export interface IPayoutsRepository {
  /** Marketplace profile for a user (the caller); null if they have none. */
  getProfileByUserId(userId: string): Promise<PayoutProfile | null>;
  /** Marketplace profile by its id. */
  getProfileById(profileId: string): Promise<PayoutProfile | null>;
  /** Persist the Stripe Connect account id on the profile. */
  /**
   * Store the Connect account id. With `onlyIfUnset`, the write is conditional
   * on the profile not already having one and the boolean reports whether THIS
   * call won — making the row the claim, so two concurrent onboarding requests
   * cannot each keep a Stripe account they created.
   */
  setConnectAccountId(
    profileId: string,
    accountId: string,
    opts?: { onlyIfUnset?: boolean },
  ): Promise<boolean>;
  /** Sync kyc_status + payouts_enabled by connect account id; false if no row. */
  syncKycByAccountId(
    accountId: string,
    patch: { kyc_status: ConsultantKycStatus; payouts_enabled: boolean },
  ): Promise<boolean>;
  /** Paid, not-yet-swept orders joined with their consultant's payout context. */
  listSweepableOrders(): Promise<SweepableOrder[]>;
  /** Insert the payout + its items (atomic enough for the sweep; items unique). */
  recordPayout(input: RecordPayoutInput): Promise<ConsultantPayout>;
  /** Earnings aggregates for a consultant. */
  getEarnings(consultantId: string): Promise<EarningsRaw>;

  // SP4 —
  /** Payout ledger + items for a consultant (history API). */
  listPayoutsByConsultant(
    consultantId: string,
  ): Promise<{ payouts: PayoutRow[]; items: PayoutItemRow[] }>;
  /** Mark a payout reversed + clear its item links so orders re-sweep. */
  markPayoutReversed(
    transferId: string,
  ): Promise<{ reversed: boolean; consultantId: string | null }>;
  /** Upsert a consultant tax profile (encrypted tax id). */
  upsertTaxProfile(input: {
    consultantId: string;
    taxCountry: string;
    formType: 'w9' | 'w8';
    taxIdEncrypted: string | null;
    businessName: string | null;
    status: 'pending' | 'submitted';
  }): Promise<void>;
  getTaxProfile(consultantId: string): Promise<TaxProfileRow | null>;
  /** Sum of paid payouts for a consultant in a tax year. */
  sumPaidForYear(
    consultantId: string,
    year: number,
  ): Promise<{ grossPaidCents: number; payoutCount: number; currency: string }>;
  upsertTaxStatement(input: {
    consultantId: string;
    taxYear: number;
    currency: string;
    grossPaidCents: number;
    payoutCount: number;
  }): Promise<TaxStatementRow>;
  listConsultantsWithPaidPayouts(year: number): Promise<string[]>;
}
