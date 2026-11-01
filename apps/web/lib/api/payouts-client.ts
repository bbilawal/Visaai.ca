import { apiFetch } from './client'

/**
 * Client-safe payout actions. Uses apiFetch ONLY (no server.ts / next/headers)
 * so it is importable from client components.
 *
 * Both routes mint short-lived Stripe URLs and resolve the caller's own
 * consultant profile server-side — the button being visible is never the
 * security boundary.
 *
 *   GET /payouts/onboarding-link   hosted KYC (Account Link)
 *   GET /payouts/dashboard-link    Express dashboard (payout schedule, 1099s)
 */
export const getOnboardingLink = (token: string) =>
  apiFetch<{ url: string; account_id: string }>('/payouts/onboarding-link', token)

export const getDashboardLink = (token: string) =>
  apiFetch<{ url: string }>('/payouts/dashboard-link', token)
