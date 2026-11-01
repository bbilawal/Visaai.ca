/**
 * Error taxonomy for the mobile network layer.
 *
 * The API returns one envelope for every failure (apps/api AllExceptionsFilter):
 *   { statusCode, error, message, details?, timestamp, path }
 * We parse that into a typed error so screens branch on `kind` instead of
 * string-matching messages. 5xx bodies are deliberately generic server-side, so
 * never surface `message` verbatim for those — use `userMessage`.
 */
export type ApiErrorKind =
  | 'offline'
  | 'cancelled'
  | 'timeout'
  | 'network'
  | 'unauthorized'
  | 'forbidden'
  | 'mfa_required'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'rate_limited'
  | 'payment_required'
  | 'server'
  | 'unknown';

export interface ApiErrorEnvelope {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
  timestamp?: string;
  path?: string;
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly details?: unknown;
  readonly path?: string;
  /** True when retrying the identical request could plausibly succeed. */
  readonly retryable: boolean;

  constructor(init: {
    kind: ApiErrorKind;
    status: number;
    message: string;
    details?: unknown;
    path?: string;
    retryable?: boolean;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.kind = init.kind;
    this.status = init.status;
    this.details = init.details;
    this.path = init.path;
    this.retryable = init.retryable ?? DEFAULT_RETRYABLE.has(init.kind);
  }

  /**
   * Copy that is safe to render. Server-side 5xx text is intentionally opaque
   * ("Internal server error"), and raw validation payloads are developer-facing.
   */
  get userMessage(): string {
    switch (this.kind) {
      case 'offline':
        return "You're offline. We'll retry when your connection is back.";
      case 'cancelled':
        return 'Cancelled.';
      case 'timeout':
        return 'That took too long. Check your connection and try again.';
      case 'network':
        return "Couldn't reach VisaAI. Check your connection and try again.";
      case 'unauthorized':
        return 'Your session expired. Please sign in again.';
      case 'mfa_required':
        return 'Confirm your identity with your authenticator app to continue.';
      case 'forbidden':
        return "You don't have access to this.";
      case 'not_found':
        return "We couldn't find that.";
      case 'conflict':
        return 'This was changed somewhere else. Reload and try again.';
      case 'rate_limited':
        return 'Too many attempts. Wait a moment and try again.';
      case 'payment_required':
        return 'This feature needs an active plan.';
      case 'validation':
        return this.message || 'Please check the highlighted fields.';
      case 'server':
        return 'Something went wrong on our side. Please try again.';
      default:
        return 'Something went wrong. Please try again.';
    }
  }
}

const DEFAULT_RETRYABLE = new Set<ApiErrorKind>([
  'offline',
  'timeout',
  'network',
  'rate_limited',
  'server',
]);

export function kindForStatus(status: number, body?: ApiErrorEnvelope): ApiErrorKind {
  // The API signals TOTP step-up with a `mfa_required` code inside a 403
  // (see apps/api modules/iam MfaGuard).
  if (status === 403 && bodyHasCode(body, 'mfa_required')) return 'mfa_required';
  switch (status) {
    case 400:
    case 422:
      return 'validation';
    case 401:
      return 'unauthorized';
    case 402:
      return 'payment_required';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 429:
      return 'rate_limited';
    default:
      return status >= 500 ? 'server' : 'unknown';
  }
}

function bodyHasCode(body: ApiErrorEnvelope | undefined, code: string): boolean {
  if (!body) return false;
  if (body.message === code) return true;
  const details = body.details as { code?: unknown } | undefined;
  return typeof details?.code === 'string' && details.code === code;
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}
