/**
 * VisaAI Partner SDK.
 *
 * Hand-written against the OpenAPI document rather than generated from it.
 * Two reasons: the generated output for this surface would be larger than what
 * is here and would still need hand-written retry, idempotency and webhook
 * verification on top; and the pieces a partner most needs to get right —
 * signature verification, retry semantics — deserve to be readable rather than
 * emitted. The `openapi-contract.spec.ts` test pins every method to a path in
 * the published document, so the two cannot drift apart silently.
 */
export * from './client';
export * from './errors';
export * from './webhooks';
export type {
  PartnerApiProduct,
  PartnerEnvironment,
  PartnerErrorBody,
  PartnerEventType,
  PartnerPage,
  PartnerScope,
  PartnerTokenResponse,
  PartnerUsageSnapshot,
  PartnerWebhookDelivery,
  PartnerWebhookEndpoint,
  PartnerWebhookPayload,
} from '@visaai/types';
