import { apiFetch } from './client';
import type { ReportDimension } from './admin-billing';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export const initiateRefund = (
  token: string,
  paymentId: string,
  amountCents?: number,
  reason?: string,
) =>
  apiFetch<{ id: string }>(
    `/admin/payments/${encodeURIComponent(paymentId)}/refund`,
    token,
    { method: 'POST', body: JSON.stringify({ amountCents, reason }) },
  );

export interface CreateCouponInput {
  code: string;
  kind: 'percent' | 'amount';
  percentOff?: number;
  amountOffCents?: number;
  appliesTo: 'processing_fee' | 'addon' | 'subscription' | 'any';
  maxRedemptions?: number;
  validUntil?: string;
}

export const createCoupon = (token: string, input: CreateCouponInput) =>
  apiFetch<{ id: string }>('/admin/coupons', token, {
    method: 'POST',
    body: JSON.stringify(input),
  });

/** Download the revenue CSV with the Bearer token (a plain <a> can't send auth). */
export async function downloadRevenueCsv(
  token: string,
  from: string,
  to: string,
  by?: ReportDimension,
): Promise<Blob> {
  const qs = new URLSearchParams({ from, to });
  if (by) qs.set('by', by);
  const res = await fetch(`${API_BASE}/admin/reports/revenue.csv?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`CSV export failed (${res.status})`);
  return res.blob();
}
