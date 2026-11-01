import { HttpException } from '@nestjs/common';
import type { PartnerErrorBody } from '@visaai/types';

/**
 * The partner error contract.
 *
 * The platform already has a global error envelope (AllExceptionsFilter), and
 * partner traffic deliberately does NOT use it. Two reasons:
 *   - the internal envelope leaks Nest's status vocabulary and a `path` field
 *     that echoes resource ids back into partner logs
 *   - a public API's error shape is part of its contract and must be versioned
 *     and stable independently of internal refactoring
 *
 * Every partner error carries a machine-readable `type` + `code`, the
 * request id (so support can find it), and a docs link.
 */

export type PartnerErrorType = PartnerErrorBody['error']['type'];

export interface PartnerErrorOptions {
  param?: string;
  retryAfter?: number;
  docUrl?: string;
}

export class PartnerApiException extends HttpException {
  /**
   * Named `httpStatus` rather than `status`: HttpException already has a
   * private `status`, and shadowing it breaks the subclass contract.
   */
  constructor(
    readonly httpStatus: number,
    readonly type: PartnerErrorType,
    readonly code: string,
    message: string,
    /** Named `errorOptions`: HttpException owns a private `options`. */
    readonly errorOptions: PartnerErrorOptions = {},
  ) {
    super(message, httpStatus);
  }

  /** Render with the request id, which is only known at the filter. */
  toBody(requestId: string): PartnerErrorBody {
    return {
      error: {
        type: this.type,
        code: this.code,
        message: this.message,
        request_id: requestId,
        ...(this.errorOptions.retryAfter !== undefined
          ? { retry_after: this.errorOptions.retryAfter }
          : {}),
        ...(this.errorOptions.param ? { param: this.errorOptions.param } : {}),
        doc_url: this.errorOptions.docUrl ?? DEFAULT_DOC_URL,
      },
    };
  }
}

const DEFAULT_DOC_URL = 'https://docs.visaai.example/partner-api/errors';

// ---- Constructors, one per situation we actually produce ---------------
// Named factories rather than raw `new` everywhere: it keeps the code
// vocabulary closed and greppable, which is what makes an error catalog
// documentable.

export const PartnerErrors = {
  invalidRequest: (message: string, param?: string) =>
    new PartnerApiException(
      400,
      'invalid_request',
      'invalid_request',
      message,
      {
        param,
      },
    ),

  missingCredential: () =>
    new PartnerApiException(
      401,
      'authentication_error',
      'missing_credential',
      'No API key or access token was provided. Send `Authorization: Bearer <credential>`.',
    ),

  invalidCredential: () =>
    new PartnerApiException(
      401,
      'authentication_error',
      'invalid_credential',
      'The credential provided is invalid, expired or revoked.',
    ),

  /**
   * Deliberately identical in shape and wording to `invalidCredential` from
   * the caller's side apart from the code, so probing cannot distinguish
   * "wrong key" from "key for a suspended app" without already holding a
   * valid credential.
   */
  applicationInactive: (reason: string) =>
    new PartnerApiException(
      403,
      'permission_error',
      'application_inactive',
      `This application cannot make requests: ${reason}`,
    ),

  ipNotAllowed: () =>
    new PartnerApiException(
      403,
      'permission_error',
      'ip_not_allowed',
      'Requests from this IP address are not permitted for this application.',
    ),

  insufficientScope: (required: string) =>
    new PartnerApiException(
      403,
      'permission_error',
      'insufficient_scope',
      `This endpoint requires the \`${required}\` scope, which this credential does not hold.`,
    ),

  consentRequired: (scope: string) =>
    new PartnerApiException(
      403,
      'permission_error',
      'consent_required',
      `The user has not granted your application the \`${scope}\` scope. Send them through the authorization flow.`,
    ),

  environmentMismatch: () =>
    new PartnerApiException(
      403,
      'permission_error',
      'environment_mismatch',
      'This resource belongs to a different environment than your credential.',
    ),

  notFound: (resource: string) =>
    new PartnerApiException(
      404,
      'not_found',
      'resource_not_found',
      `No ${resource} was found with that identifier.`,
    ),

  conflict: (code: string, message: string) =>
    new PartnerApiException(409, 'conflict', code, message),

  idempotencyMismatch: () =>
    new PartnerApiException(
      409,
      'conflict',
      'idempotency_key_reuse',
      'This Idempotency-Key was already used with a different request body. Use a new key for a new request.',
    ),

  idempotencyInFlight: () =>
    new PartnerApiException(
      409,
      'conflict',
      'idempotency_in_progress',
      'A request with this Idempotency-Key is still being processed. Retry shortly.',
      { retryAfter: 2 },
    ),

  payloadTooLarge: (limitBytes: number) =>
    new PartnerApiException(
      413,
      'invalid_request',
      'payload_too_large',
      `Request body exceeds the ${limitBytes} byte limit.`,
    ),

  rateLimited: (retryAfter: number) =>
    new PartnerApiException(
      429,
      'rate_limit_error',
      'rate_limit_exceeded',
      'Too many requests. Slow down and retry after the interval indicated.',
      { retryAfter },
    ),

  quotaExceeded: (window: string, retryAfter: number) =>
    new PartnerApiException(
      429,
      'quota_exceeded',
      `quota_exceeded_${window}`,
      `Your ${window} request quota is exhausted.`,
      { retryAfter },
    ),

  internal: () =>
    new PartnerApiException(
      500,
      'api_error',
      'internal_error',
      'Something went wrong on our side. The request id identifies this failure in our logs.',
    ),
} as const;

/** OAuth 2.0 token-endpoint errors use RFC 6749's own body, not ours. */
export interface OAuthErrorBody {
  error:
    | 'invalid_request'
    | 'invalid_client'
    | 'invalid_grant'
    | 'unauthorized_client'
    | 'unsupported_grant_type'
    | 'invalid_scope';
  error_description: string;
}

export class OAuthException extends HttpException {
  constructor(
    status: number,
    readonly oauthError: OAuthErrorBody['error'],
    description: string,
  ) {
    super({ error: oauthError, error_description: description }, status);
  }
}
