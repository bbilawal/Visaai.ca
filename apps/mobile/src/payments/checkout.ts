import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { billingApi } from '@/api/endpoints';
import { analytics, EVENTS } from '@/analytics/analytics';

/**
 * Payments on mobile.
 *
 * WHAT THIS DOES: asks the API for a Stripe Checkout / Billing Portal URL
 * (the same POST /billing/checkout and POST /billing/portal the web app uses)
 * and opens it in the system browser via an auth session, then returns to the
 * app through the registered deep link.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *  - collect card details in the app (that would pull the binary into PCI scope);
 *  - render Stripe inside an embedded WebView (a hostile-looking pattern that
 *    both stores reject and that breaks 3-D Secure redirects);
 *  - implement its own payment logic — the server remains the only authority on
 *    price, entitlement, and what was actually paid. The app never trusts a
 *    "success" URL; it re-reads billing state from the API on return.
 *
 * STORE POLICY (needs a human decision before submission — see
 * VISAAIDocs/mobile/known-limitations.md): Apple requires in-app purchase for digital
 * content consumed in the app, but permits external payment for *real-world*
 * services. VisaAI sells immigration consulting and case handling performed by
 * licensed humans, which reads as a real-world service — but this is a business
 * and legal judgement, not an engineering one, and Apple reviewers apply it
 * case by case. Confirm before the first submission.
 */
export type CheckoutOutcome = 'completed' | 'cancelled' | 'failed';

export interface CheckoutResult {
  outcome: CheckoutOutcome;
  /** Present when the browser returned through our deep link. */
  returnUrl?: string;
}

function returnUrl(path: string): string {
  // A verified deep link back into the app. Path only — never a token.
  return Linking.createURL(path);
}

async function openExternal(url: string, redirectPath: string): Promise<CheckoutResult> {
  try {
    const result = await WebBrowser.openAuthSessionAsync(url, returnUrl(redirectPath));
    if (result.type === 'success') {
      analytics.track(EVENTS.paymentReturned, { outcome: 'completed' });
      return { outcome: 'completed', returnUrl: result.url };
    }
    // 'cancel' / 'dismiss' — the user backed out, or the sheet closed. This is
    // NOT proof the payment failed: a webhook may still complete it, which is
    // exactly why the caller must re-read billing state instead of trusting this.
    analytics.track(EVENTS.paymentReturned, { outcome: 'cancelled' });
    return { outcome: 'cancelled' };
  } catch {
    analytics.track(EVENTS.paymentReturned, { outcome: 'failed' });
    return { outcome: 'failed' };
  }
}

export type PlanTier = 'self_service' | 'copilot' | 'expert';

export const payments = {
  /**
   * Start a Stripe Checkout session.
   *
   * CheckoutBodyDto requires applicationId + planTier + both redirect URLs;
   * a plan alone was rejected with a 400 on every attempt. Checkout is always
   * scoped to a specific application because that is what the server prices.
   */
  async startCheckout(input: {
    applicationId: string;
    planTier: PlanTier;
  }): Promise<CheckoutResult> {
    analytics.track(EVENTS.paymentCheckoutStarted, { plan: input.planTier });
    const session = await billingApi.checkout({
      applicationId: input.applicationId,
      planTier: input.planTier,
      successUrl: returnUrl('payment/return'),
      cancelUrl: returnUrl('payment/return'),
    });
    if (!session?.url) return { outcome: 'failed' };
    return openExternal(session.url, 'payment/return');
  },

  /** Open the Stripe Billing Portal (manage/cancel/update card). */
  async openBillingPortal(): Promise<CheckoutResult> {
    const session = await billingApi.portal(returnUrl('billing'));
    if (!session?.url) return { outcome: 'failed' };
    return openExternal(session.url, 'billing');
  },
};
