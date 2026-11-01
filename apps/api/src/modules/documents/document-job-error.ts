import { UnrecoverableError } from 'bullmq';

/**
 * The error a document job throws when the graph reported a failure.
 *
 * A transient failure (an exhausted 429, a timeout) is a plain Error, so BullMQ
 * retries it on its exponential backoff. A failure that will repeat on every
 * attempt — a 4xx other than 408/429, a document Azure cannot read, a
 * residency/MIME block — is an UnrecoverableError: retrying it only spends
 * quota and, before 2026-10-14, stacked a duplicate "Identity ✗ Fail" row per
 * attempt. Unknown (null) defaults to retryable, the previous behaviour.
 */
export function documentJobError(
  documentId: string,
  error: string,
  retryable: boolean | null | undefined,
): Error {
  const message = `Document processing failed for ${documentId}: ${error}`;
  return retryable === false
    ? new UnrecoverableError(message)
    : new Error(message);
}
