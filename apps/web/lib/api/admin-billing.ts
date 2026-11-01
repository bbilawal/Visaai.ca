import { serverApi } from './server';

export type SubPlan = 'base' | 'pro' | 'premium';
export type ReportDimension = 'country' | 'visa' | 'plan' | 'feature';

export interface SubscriptionMetrics {
  active: number;
  byPlan: Record<SubPlan, number>;
  mrrCents: number;
  arrCents: number;
}
export interface Outstanding {
  count: number;
  amountCents: number;
}
export interface RevenueSummary {
  collectedCents: number;
  refundedCents: number;
  netCents: number;
  count: number;
}
export interface RevenueReport {
  summary: RevenueSummary;
  breakdown?: { key: string; netCents: number }[];
}
export interface RefundRow {
  id: string;
  payment_id: string | null;
  amount_cents: number;
  reason: string | null;
  status: string;
  created_at: string;
}
export interface DisputeRow {
  id: string;
  provider_object_id: string;
  amount_cents: number | null;
  currency: string | null;
  status: string;
  reason: string | null;
  created_at: string;
}

export const getSubscriptionMetrics = () =>
  serverApi<SubscriptionMetrics>('/admin/analytics/subscriptions');

export const getOutstanding = () =>
  serverApi<Outstanding>('/admin/analytics/outstanding');

export const getRevenueReport = (from: string, to: string, by?: ReportDimension) => {
  const qs = new URLSearchParams({ from, to });
  if (by) qs.set('by', by);
  return serverApi<RevenueReport>(`/admin/reports/revenue?${qs.toString()}`);
};

export const getRefunds = () => serverApi<RefundRow[]>('/admin/refunds');
export const getDisputes = () => serverApi<DisputeRow[]>('/admin/disputes');
