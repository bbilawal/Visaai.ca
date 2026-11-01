import { serverApi } from './server'
import type { ConsultantEarnings } from '@visaai/types'

/** Onboarding state, so the page can tell "not started" from "awaiting Stripe". */
export interface PayoutStatus {
  kyc_status: 'none' | 'pending' | 'verified' | 'rejected'
  payouts_enabled: boolean
  /** A Stripe Connect account exists for this consultant. */
  onboarded: boolean
}

export interface PayoutRow {
  id: string
  amount_usd: number
  currency: string
  status: string
  period_end: string | null
  stripe_transfer_id: string | null
  created_at: string
}

export interface PayoutItemRow {
  payout_id: string
  service_order_id: string
  amount_usd: number
  /** Per-order transfer. Grouped legacy payouts carry theirs on the payout row. */
  stripe_transfer_id?: string | null
}

export interface PayoutHistory {
  payouts: PayoutRow[]
  items: PayoutItemRow[]
}

/** Server-side: onboarding/KYC state for the current consultant. */
export const getPayoutStatus = () => serverApi<PayoutStatus>('/payouts/status')

/** Server-side: lifetime / paid-out / pending totals. */
export const getPayoutEarnings = () => serverApi<ConsultantEarnings>('/payouts/earnings')

/** Server-side: payout ledger + the orders each payout swept. */
export const getPayoutHistory = () => serverApi<PayoutHistory>('/payouts/history')
