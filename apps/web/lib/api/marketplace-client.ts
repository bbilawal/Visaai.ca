import { apiFetch } from './client'
import type { ConsultantServiceType } from './marketplace'

/**
 * Buy a consultant service. Client-safe (apiFetch only, no next/headers).
 *
 * No amount is sent — the API resolves the price from SERVICE_PRICES, splits it
 * with the commission engine, writes the pending order, and returns a Stripe
 * Checkout URL. The webhook flips the order to `paid`, and the payout sweep
 * later transfers the consultant's share.
 *
 * `creditCovered` comes back instead of `url` when a subscription review credit
 * paid for it — there is no checkout to redirect to in that case.
 */
export interface ServiceOrderCheckout {
  url?: string
  serviceOrderId: string
  creditCovered?: boolean
}

export const createServiceOrderCheckout = (
  token: string,
  body: {
    consultantId: string
    serviceType: ConsultantServiceType
    applicationId?: string
    successUrl: string
    cancelUrl: string
  },
) =>
  apiFetch<ServiceOrderCheckout>('/billing/checkout/service-order', token, {
    method: 'POST',
    body: JSON.stringify(body),
  })
