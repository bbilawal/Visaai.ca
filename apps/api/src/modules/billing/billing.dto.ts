import { z } from 'zod';

/**
 * Runtime validation for billing/checkout request bodies (SEC — payment-input
 * hardening). Prior to this the controller bound bare TypeScript interfaces,
 * which are erased at build time, so `applicationId`, plan tier, SKUs, coupon
 * codes and redirect URLs reached Stripe + DB writes completely unvalidated.
 *
 * Mirrors the existing zod `safeParse` pattern used in the marketplace module.
 * Redirect URLs are additionally checked against `WEB_URL` inside
 * `BillingService`; here we enforce they are syntactically valid, bounded URLs.
 */
const uuid = z.string().uuid();
const redirectUrl = z.string().url().max(2048);
const couponCode = z.string().trim().min(1).max(64).optional();

export const CheckoutBodyDto = z.object({
  applicationId: uuid,
  planTier: z.enum(['self_service', 'copilot', 'expert']),
  successUrl: redirectUrl,
  cancelUrl: redirectUrl,
});

export const PrefillCheckoutBodyDto = z.object({
  applicationId: uuid,
  successUrl: redirectUrl,
  cancelUrl: redirectUrl,
});

export const ProcessingFeeCheckoutBodyDto = z.object({
  applicationId: uuid,
  successUrl: redirectUrl,
  cancelUrl: redirectUrl,
  couponCode,
});

export const AddonCheckoutBodyDto = z.object({
  applicationId: uuid,
  addonSku: z.enum([
    'addon_document_review',
    'addon_rush_sla',
    'addon_premium_upgrade',
  ]),
  couponCode,
  successUrl: redirectUrl,
  cancelUrl: redirectUrl,
});

export const ServiceOrderCheckoutBodyDto = z.object({
  consultantId: uuid,
  serviceType: z.enum([
    'premium_review',
    'consultation',
    'priority_processing',
    'document_review',
  ]),
  applicationId: uuid.optional(),
  successUrl: redirectUrl,
  cancelUrl: redirectUrl,
});

export const PortalBodyDto = z.object({
  returnUrl: redirectUrl,
});
