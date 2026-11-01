import { z } from 'zod';

/**
 * Runtime validation for subscription request bodies (payment-input hardening).
 * Replaces the erased TS interfaces the controller bound previously.
 */
const redirectUrl = z.string().url().max(2048);
const plan = z.enum(['base', 'pro', 'premium']);
const interval = z.enum(['month', 'year']);

export const SubCheckoutBodyDto = z.object({
  plan,
  interval,
  successUrl: redirectUrl,
  cancelUrl: redirectUrl,
});

export const SubChangeBodyDto = z.object({
  plan,
  interval,
});

export const SubCancelBodyDto = z.object({
  immediate: z.boolean().optional(),
});
