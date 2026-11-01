import type { PartnerErrorBody } from '@visaai/types';

/**
 * A typed error for every non-2xx response.
 *
 * `requestId` is on the class, not buried in a body: it is the one value
 * support will ask for, and a partner should be able to log it without
 * knowing our envelope shape.
 */
export class VisaAiApiError extends Error {
  readonly status: number;
  readonly type: PartnerErrorBody['error']['type'] | 'unknown';
  readonly code: string;
  readonly requestId: string;
  readonly retryAfter: number | null;
  readonly param: string | null;
  readonly docUrl: string | null;

  constructor(status: number, body: unknown, requestId: string) {
    const error = (body as PartnerErrorBody | undefined)?.error;
    super(error?.message ?? `VisaAI API error (HTTP ${status})`);
    this.name = 'VisaAiApiError';
    this.status = status;
    this.type = error?.type ?? 'unknown';
    this.code = error?.code ?? 'unknown';
    this.requestId = error?.request_id ?? requestId;
    this.retryAfter = error?.retry_after ?? null;
    this.param = error?.param ?? null;
    this.docUrl = error?.doc_url ?? null;
  }

  /**
   * Whether retrying this exact request could succeed.
   *
   * 429 and 5xx are transient. 4xx are not: retrying a 403 for insufficient
   * scope just burns quota, and retrying a 409 idempotency mismatch will
   * mismatch again.
   */
  get isRetryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

/** Network-level failure: no HTTP response at all. */
export class VisaAiConnectionError extends Error {
  constructor(readonly cause: unknown) {
    super(`Could not reach the VisaAI API: ${(cause as Error)?.message ?? cause}`);
    this.name = 'VisaAiConnectionError';
  }
}

/** A webhook payload that failed signature verification. */
export class VisaAiSignatureError extends Error {
  constructor(readonly reason: string) {
    super(`Webhook signature verification failed: ${reason}`);
    this.name = 'VisaAiSignatureError';
  }
}
