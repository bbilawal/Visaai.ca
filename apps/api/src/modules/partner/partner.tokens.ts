/** DI tokens for the partner platform. Mirrors voice.tokens.ts. */
export const PARTNER_REPOSITORY = Symbol('PARTNER_REPOSITORY');
export const PARTNER_WEBHOOK_SENDER = Symbol('PARTNER_WEBHOOK_SENDER');

/**
 * Config keys. All limits and TTLs are configuration, never literals buried in
 * a service — an operator has to be able to change them without a deploy of
 * new code.
 */
export const PARTNER_CONFIG = {
  /** Access-token lifetime, seconds. Short: these are machine credentials. */
  tokenTtlSeconds: 'PARTNER_TOKEN_TTL_SEC',
  /** Authorization-code lifetime, seconds. RFC 6749 recommends ≤ 600. */
  authCodeTtlSeconds: 'PARTNER_AUTH_CODE_TTL_SEC',
  /** How long a rotated API key keeps working. */
  keyRotationGraceHours: 'PARTNER_KEY_ROTATION_GRACE_HOURS',
  /** Webhook HTTP timeout, ms. */
  webhookTimeoutMs: 'PARTNER_WEBHOOK_TIMEOUT_MS',
  /** Secret-rotation overlap for webhook signing. */
  webhookSecretOverlapHours: 'PARTNER_WEBHOOK_SECRET_OVERLAP_HOURS',
} as const;

export const PARTNER_DEFAULTS = {
  tokenTtlSeconds: 3600,
  authCodeTtlSeconds: 300,
  keyRotationGraceHours: 48,
  webhookTimeoutMs: 10_000,
  webhookSecretOverlapHours: 24,
} as const;
